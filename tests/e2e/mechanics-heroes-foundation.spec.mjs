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

  test("enables, edits, saves, reloads, disables, and re-enables a v3 durable hero profile", async ({ page }) => {
    test.setTimeout(120_000);
    const balancePath = path.join(projectDir, "content", "balance.json");
    const mechanicsPath = path.join(projectDir, "content", "mechanics.json");
    const originalBalanceBytes = fs.readFileSync(balancePath, "utf8");
    const originalMechanicsBytes = fs.existsSync(mechanicsPath) ? fs.readFileSync(mechanicsPath, "utf8") : null;
    try {
      await openStudio(page, studioUrl);
      await openHeroesMechanics(page);
      await expect(page.locator('#mechanics-recipe-select option[value="basic_durable_commander_hero"]'))
        .toHaveCount(1);
      await page.locator("#mechanics-recipe-select").selectOption("basic_durable_commander_hero");
      await page.locator("#btn-mechanics-new-profile").click();
      await expect(page.locator("#mechanics-profile-id")).toHaveValue("basic_durable_commander_hero");
      const commander = page.locator('[data-hero-definition-id="commander"]');
      await expect(commander.locator("[data-hero-max-hp]")).toHaveValue("100");
      await expect(commander.locator("[data-hero-shield-enabled]")).toBeChecked();
      await commander.locator("[data-hero-max-hp]").fill("120");
      await commander.locator("[data-hero-shield-capacity]").fill("30");

      const beforePreview = readHeroesState(projectDir);
      await page.locator("#btn-mechanics-preview").click();
      await expect(page.locator("#mechanics-preview-result")).toContainText('"ok": true');
      expect(readHeroesState(projectDir)).toEqual(beforePreview);
      await page.locator("#btn-mechanics-enable").click();
      await expect.poll(() => readHeroesState(projectDir)).toMatchObject({
        moduleSchemaVersion: 3,
        enabled: true,
        selectedProfileId: "basic_durable_commander_hero",
        profile: {
          definitions: {
            commander: { durability: { maxHp: 120, shield: { capacity: 30 } } }
          }
        }
      });

      await page.reload();
      await openHeroesMechanics(page);
      const reloaded = page.locator('[data-hero-definition-id="commander"]');
      await expect(reloaded.locator("[data-hero-max-hp]")).toHaveValue("120");
      const beforeMalformedPreview = readHeroesState(projectDir);
      await reloaded.locator("[data-hero-max-hp]").fill("0");
      await page.locator("#btn-mechanics-preview").click();
      await expect(page.locator("#mechanics-preview-result")).toContainText(/maxHp|positive|greater|range/i);
      await expect(page.locator("#mechanics-preview-result")).not.toContainText('"ok": true');
      expect(readHeroesState(projectDir)).toEqual(beforeMalformedPreview);
      await reloaded.locator("[data-hero-max-hp]").fill("120");
      await reloaded.locator("[data-hero-shield-capacity]").fill("40");
      await page.locator("#btn-mechanics-save").click();
      await expect.poll(() => (
        readHeroesState(projectDir).profile?.definitions?.commander?.durability?.shield?.capacity
      )).toBe(40);

      await page.reload();
      await openHeroesMechanics(page);
      await expect(page.locator('[data-hero-definition-id="commander"] [data-hero-shield-capacity]'))
        .toHaveValue("40");
      const preservedProfile = structuredClone(readHeroesState(projectDir).profile);
      page.once("dialog", (dialog) => dialog.accept());
      await page.locator("#btn-mechanics-disable").click();
      await expect.poll(() => readHeroesState(projectDir)).toMatchObject({
        enabled: false,
        selectedProfileId: "basic_durable_commander_hero",
        profile: preservedProfile
      });
      await page.locator("#btn-mechanics-enable").click();
      await expect.poll(() => readHeroesState(projectDir)).toMatchObject({
        enabled: true,
        selectedProfileId: "basic_durable_commander_hero",
        profile: preservedProfile
      });
    } finally {
      fs.writeFileSync(balancePath, originalBalanceBytes, "utf8");
      if (originalMechanicsBytes === null) fs.rmSync(mechanicsPath, { force: true });
      else fs.writeFileSync(mechanicsPath, originalMechanicsBytes, "utf8");
    }
  });

  test("enables, edits, saves, reloads, disables, and re-enables a v4 targeted hero ability", async ({ page }) => {
    test.setTimeout(120_000);
    const balancePath = path.join(projectDir, "content", "balance.json");
    const mechanicsPath = path.join(projectDir, "content", "mechanics.json");
    const originalBalanceBytes = fs.readFileSync(balancePath, "utf8");
    const originalMechanicsBytes = fs.existsSync(mechanicsPath) ? fs.readFileSync(mechanicsPath, "utf8") : null;
    try {
      await openStudio(page, studioUrl);
      await openHeroesMechanics(page);
      await expect(page.locator('#mechanics-recipe-select option[value="basic_targeted_hero_ability"]'))
        .toHaveCount(1);
      await page.locator("#mechanics-recipe-select").selectOption("basic_targeted_hero_ability");
      await page.locator("#btn-mechanics-new-profile").click();
      await expect(page.locator("#mechanics-profile-id")).toHaveValue("basic_targeted_hero_ability");
      const commander = page.locator('[data-hero-definition-id="commander"]');
      await expect(commander.locator("[data-hero-mana-max]")).toHaveValue("100");
      await expect(commander.locator("[data-hero-ability-id]")).toHaveValue("arc_bolt");
      await commander.locator("[data-hero-mana-max]").fill("120");
      await commander.locator("[data-hero-mana-starting]").fill("80");
      await commander.locator("[data-hero-mana-regeneration]").fill("6");
      await commander.locator("[data-hero-ability-label]").fill("Arc Lance");
      await commander.locator("[data-hero-ability-mana-cost]").fill("25");
      await commander.locator("[data-hero-ability-cooldown]").fill("4");
      await commander.locator("[data-hero-ability-range]").fill("7");
      await commander.locator("[data-hero-ability-damage]").fill("35");

      const beforePreview = readHeroesState(projectDir);
      await page.locator("#btn-mechanics-preview").click();
      await expect(page.locator("#mechanics-preview-result")).toContainText('"ok": true');
      expect(readHeroesState(projectDir)).toEqual(beforePreview);
      await page.locator("#btn-mechanics-enable").click();
      await expect.poll(() => readHeroesState(projectDir)).toMatchObject({
        moduleSchemaVersion: 4,
        enabled: true,
        selectedProfileId: "basic_targeted_hero_ability",
        profile: {
          definitions: {
            commander: {
              mana: { max: 120, starting: 80, regenerationPerUnit: 6 },
              activeAbility: {
                id: "arc_bolt", label: "Arc Lance", target: "enemy",
                manaCost: 25, cooldown: 4, range: 7, damage: 35
              }
            }
          }
        }
      });

      await page.reload();
      await openHeroesMechanics(page);
      const reloaded = page.locator('[data-hero-definition-id="commander"]');
      await expect(reloaded.locator("[data-hero-ability-label]")).toHaveValue("Arc Lance");
      const beforeInvalidPreview = readHeroesState(projectDir);
      await reloaded.locator("[data-hero-ability-mana-cost]").fill("0");
      await page.locator("#btn-mechanics-preview").click();
      await expect(page.locator("#mechanics-preview-result")).toContainText(/manaCost|positive|greater|range/i);
      await expect(page.locator("#mechanics-preview-result")).not.toContainText('"ok": true');
      expect(readHeroesState(projectDir)).toEqual(beforeInvalidPreview);
      await reloaded.locator("[data-hero-ability-mana-cost]").fill("25");
      await reloaded.locator("[data-hero-ability-damage]").fill("42");
      await page.locator("#btn-mechanics-save").click();
      await expect.poll(() => (
        readHeroesState(projectDir).profile?.definitions?.commander?.activeAbility?.damage
      )).toBe(42);

      await page.reload();
      await openHeroesMechanics(page);
      await expect(page.locator('[data-hero-definition-id="commander"] [data-hero-ability-damage]'))
        .toHaveValue("42");
      const preservedProfile = structuredClone(readHeroesState(projectDir).profile);
      page.once("dialog", (dialog) => dialog.accept());
      await page.locator("#btn-mechanics-disable").click();
      await expect.poll(() => readHeroesState(projectDir)).toMatchObject({
        enabled: false,
        selectedProfileId: "basic_targeted_hero_ability",
        profile: preservedProfile
      });
      await page.locator("#btn-mechanics-enable").click();
      await expect.poll(() => readHeroesState(projectDir)).toMatchObject({
        enabled: true,
        selectedProfileId: "basic_targeted_hero_ability",
        profile: preservedProfile
      });
    } finally {
      fs.writeFileSync(balancePath, originalBalanceBytes, "utf8");
      if (originalMechanicsBytes === null) fs.rmSync(mechanicsPath, { force: true });
      else fs.writeFileSync(mechanicsPath, originalMechanicsBytes, "utf8");
    }
  });

  test("enables, edits, saves, reloads, disables, and re-enables a v5 battle-local skill tree", async ({ page }) => {
    test.setTimeout(120_000);
    const balancePath = path.join(projectDir, "content", "balance.json");
    const mechanicsPath = path.join(projectDir, "content", "mechanics.json");
    const originalBalanceBytes = fs.readFileSync(balancePath, "utf8");
    const originalMechanicsBytes = fs.existsSync(mechanicsPath) ? fs.readFileSync(mechanicsPath, "utf8") : null;
    try {
      await openStudio(page, studioUrl);
      await openHeroesMechanics(page);
      await expect(page.locator('#mechanics-recipe-select option[value="basic_hero_skill_tree"]'))
        .toHaveCount(1);
      await page.locator("#mechanics-recipe-select").selectOption("basic_hero_skill_tree");
      await page.locator("#btn-mechanics-new-profile").click();
      await expect(page.locator("#mechanics-profile-id")).toHaveValue("basic_hero_skill_tree");

      const commander = page.locator('[data-hero-definition-id="commander"]');
      await expect(commander.locator("[data-hero-skill-tree-enabled]")).toBeChecked();
      await commander.locator("[data-hero-skill-starting-points]").fill("2");
      await commander.locator("[data-hero-skill-points-per-interwave]").fill("2");
      const node = commander.locator("[data-hero-skill-node-id]").first();
      await expect(node).toBeVisible();
      const nodeId = await node.locator("[data-hero-skill-id]").inputValue();
      expect(nodeId).not.toBe("");
      await node.locator("[data-hero-skill-label]").fill("Focused Cast+");
      await node.locator("[data-hero-skill-description]").fill("Authored in Mechanics Hub.");
      await node.locator("[data-hero-skill-value]").fill("1.5");

      const beforePreview = readHeroesState(projectDir);
      await page.locator("#btn-mechanics-preview").click();
      await expect(page.locator("#mechanics-preview-result")).toContainText('"ok": true');
      expect(readHeroesState(projectDir)).toEqual(beforePreview);
      await page.locator("#btn-mechanics-enable").click();
      await expect.poll(() => readHeroesState(projectDir)).toMatchObject({
        moduleSchemaVersion: 5,
        enabled: true,
        selectedProfileId: "basic_hero_skill_tree",
        profile: {
          definitions: {
            commander: {
              skillTree: {
                points: { starting: 2, perInterwave: 2 },
                nodes: {
                  [nodeId]: {
                    label: "Focused Cast+",
                    description: "Authored in Mechanics Hub.",
                    effects: [{
                      kind: "modifier",
                      scope: "hero_ability_damage",
                      modifier: { target: "damage", value: 1.5 }
                    }]
                  }
                }
              }
            }
          }
        }
      });

      await page.reload();
      await openHeroesMechanics(page);
      const reloadedNode = page.locator(`[data-hero-skill-node-id="${nodeId}"]`);
      await expect(reloadedNode.locator("[data-hero-skill-label]")).toHaveValue("Focused Cast+");
      const beforeInvalidPreview = readHeroesState(projectDir);
      await reloadedNode.locator("[data-hero-skill-cost]").fill("0");
      await page.locator("#btn-mechanics-preview").click();
      await expect(page.locator("#mechanics-preview-result")).toContainText(/cost|positive|greater|range/i);
      await expect(page.locator("#mechanics-preview-result")).not.toContainText('"ok": true');
      expect(readHeroesState(projectDir)).toEqual(beforeInvalidPreview);
      await reloadedNode.locator("[data-hero-skill-cost]").fill("1");
      await reloadedNode.locator("[data-hero-skill-description]").fill("Saved battle-local upgrade.");
      await page.locator("#btn-mechanics-save").click();
      await expect.poll(() => (
        readHeroesState(projectDir).profile?.definitions?.commander?.skillTree?.nodes?.[nodeId]?.description
      )).toBe("Saved battle-local upgrade.");

      await page.reload();
      await openHeroesMechanics(page);
      await expect(page.locator(`[data-hero-skill-node-id="${nodeId}"] [data-hero-skill-description]`))
        .toHaveValue("Saved battle-local upgrade.");
      const preservedProfile = structuredClone(readHeroesState(projectDir).profile);
      page.once("dialog", (dialog) => dialog.accept());
      await page.locator("#btn-mechanics-disable").click();
      await expect.poll(() => readHeroesState(projectDir)).toMatchObject({
        enabled: false,
        selectedProfileId: "basic_hero_skill_tree",
        profile: preservedProfile
      });
      await page.locator("#btn-mechanics-enable").click();
      await expect.poll(() => readHeroesState(projectDir)).toMatchObject({
        enabled: true,
        selectedProfileId: "basic_hero_skill_tree",
        profile: preservedProfile
      });
    } finally {
      fs.writeFileSync(balancePath, originalBalanceBytes, "utf8");
      if (originalMechanicsBytes === null) fs.rmSync(mechanicsPath, { force: true });
      else fs.writeFileSync(mechanicsPath, originalMechanicsBytes, "utf8");
    }
  });

  test("promotes every definition in a multi-hero v4 profile to explicit v5 tree-or-null", async ({ page }) => {
    test.setTimeout(120_000);
    const balancePath = path.join(projectDir, "content", "balance.json");
    const mechanicsPath = path.join(projectDir, "content", "mechanics.json");
    const originalBalanceBytes = fs.readFileSync(balancePath, "utf8");
    const originalMechanicsBytes = fs.existsSync(mechanicsPath) ? fs.readFileSync(mechanicsPath, "utf8") : null;
    try {
      await openStudio(page, studioUrl);
      await openHeroesMechanics(page);
      await page.locator("#mechanics-recipe-select").selectOption("basic_targeted_hero_ability");
      await page.locator("#btn-mechanics-new-profile").click();
      await page.locator("#btn-mechanics-add-hero").click();
      await page.locator('[data-hero-definition-id="hero_2"] [data-hero-label]').fill("Warden");
      await page.locator("#btn-mechanics-enable").click();
      await expect.poll(() => readHeroesState(projectDir).moduleSchemaVersion).toBe(4);

      await page.reload();
      await openHeroesMechanics(page);
      const beforePromotion = readHeroesState(projectDir);
      await page.locator('[data-hero-definition-id="commander"] [data-hero-skill-tree-enabled]').check();
      await page.locator("#btn-mechanics-preview").click();
      await expect(page.locator("#mechanics-preview-result")).toContainText('"ok": true');
      expect(readHeroesState(projectDir)).toEqual(beforePromotion);

      await page.locator("#btn-mechanics-save").click();
      await expect.poll(() => readHeroesState(projectDir)).toMatchObject({
        moduleSchemaVersion: 5,
        profile: {
          definitions: {
            commander: { skillTree: { points: { starting: 1, perInterwave: 1 } } },
            hero_2: { skillTree: null }
          }
        }
      });
    } finally {
      fs.writeFileSync(balancePath, originalBalanceBytes, "utf8");
      if (originalMechanicsBytes === null) fs.rmSync(mechanicsPath, { force: true });
      else fs.writeFileSync(mechanicsPath, originalMechanicsBytes, "utf8");
    }
  });

  test("exposes, adds, removes, and saves every bounded skill effect", async ({ page }) => {
    test.setTimeout(120_000);
    const balancePath = path.join(projectDir, "content", "balance.json");
    const mechanicsPath = path.join(projectDir, "content", "mechanics.json");
    const originalBalanceBytes = fs.readFileSync(balancePath, "utf8");
    const originalMechanicsBytes = fs.existsSync(mechanicsPath) ? fs.readFileSync(mechanicsPath, "utf8") : null;
    try {
      await openStudio(page, studioUrl);
      await openHeroesMechanics(page);
      await page.locator("#mechanics-recipe-select").selectOption("basic_hero_skill_tree");
      await page.locator("#btn-mechanics-new-profile").click();
      await page.locator("#btn-mechanics-enable").click();
      await expect.poll(() => fs.existsSync(mechanicsPath)).toBe(true);
      await expect.poll(() => readHeroesState(projectDir)).toMatchObject({
        moduleSchemaVersion: 5,
        enabled: true,
        selectedProfileId: "basic_hero_skill_tree"
      });

      const mechanics = readJson(mechanicsPath);
      const authoredEffects = mechanics.modules.heroes.profiles.basic_hero_skill_tree
        .definitions.commander.skillTree.nodes.focused_cast.effects;
      authoredEffects.push({
        kind: "modifier",
        scope: "hero_ability_damage",
        modifier: { target: "damage", operation: "flat", value: 10 }
      });
      writeJson(mechanicsPath, mechanics);

      await page.reload();
      await openHeroesMechanics(page);
      const node = page.locator('[data-hero-skill-node-id="focused_cast"]');
      const effects = node.locator("[data-hero-skill-effect-row]");
      await expect(effects).toHaveCount(2);
      await effects.nth(1).locator("[data-hero-skill-effect-value]").fill("12");

      await node.locator("[data-add-hero-skill-effect]").click();
      await node.locator("[data-add-hero-skill-effect]").click();
      await expect(effects).toHaveCount(4);
      await expect(node.locator("[data-add-hero-skill-effect]")).toBeDisabled();
      await effects.nth(3).locator("[data-hero-skill-effect-operation]").selectOption("additive_ratio");
      await effects.nth(3).locator("[data-hero-skill-effect-value]").fill("0.2");
      await effects.nth(2).locator("[data-remove-hero-skill-effect]").click();
      await expect(effects).toHaveCount(3);

      await page.locator("#btn-mechanics-save").click();
      await expect.poll(() => (
        readHeroesState(projectDir).profile?.definitions?.commander?.skillTree
          ?.nodes?.focused_cast?.effects
      )).toEqual([
        expect.objectContaining({ modifier: expect.objectContaining({ operation: "multiplier", value: 1.25 }) }),
        expect.objectContaining({ modifier: expect.objectContaining({ operation: "flat", value: 12 }) }),
        expect.objectContaining({ modifier: expect.objectContaining({ operation: "additive_ratio", value: 0.2 }) })
      ]);
    } finally {
      fs.writeFileSync(balancePath, originalBalanceBytes, "utf8");
      if (originalMechanicsBytes === null) fs.rmSync(mechanicsPath, { force: true });
      else fs.writeFileSync(mechanicsPath, originalMechanicsBytes, "utf8");
    }
  });

  test("promotes every v5 definition and preserves the full v6 passive-aura lifecycle", async ({ page }) => {
    test.setTimeout(120_000);
    const balancePath = path.join(projectDir, "content", "balance.json");
    const mechanicsPath = path.join(projectDir, "content", "mechanics.json");
    const originalBalanceBytes = fs.readFileSync(balancePath, "utf8");
    const originalMechanicsBytes = fs.existsSync(mechanicsPath) ? fs.readFileSync(mechanicsPath, "utf8") : null;
    try {
      await openStudio(page, studioUrl);
      await openHeroesMechanics(page);
      await page.locator("#mechanics-recipe-select").selectOption("basic_hero_skill_tree");
      await page.locator("#btn-mechanics-new-profile").click();
      await page.locator("#btn-mechanics-add-hero").click();
      await page.locator('[data-hero-definition-id="hero_2"] [data-hero-label]').fill("Warden");
      await page.locator("#btn-mechanics-enable").click();
      await expect.poll(() => readHeroesState(projectDir)).toMatchObject({
        moduleSchemaVersion: 5,
        enabled: true,
        selectedProfileId: "basic_hero_skill_tree"
      });

      await page.reload();
      await openHeroesMechanics(page);
      const commander = page.locator('[data-hero-definition-id="commander"]');
      const warden = page.locator('[data-hero-definition-id="hero_2"]');
      await expect(commander.locator("[data-hero-passive-aura-enabled]")).not.toBeChecked();
      await commander.locator("[data-hero-passive-aura-enabled]").check();
      await expect(warden.locator("[data-hero-passive-aura-enabled]")).not.toBeChecked();
      await commander.locator("[data-hero-passive-aura-id]").fill("field_command");
      await commander.locator("[data-hero-passive-aura-label]").fill("Field Command");
      await commander.locator("[data-hero-passive-aura-radius]").fill("4");

      const effects = commander.locator("[data-hero-passive-aura-effect-row]");
      await expect(effects).toHaveCount(1);
      for (let count = 1; count < 4; count += 1) {
        await commander.locator("[data-add-hero-passive-aura-effect]").click();
        await expect(effects).toHaveCount(count + 1);
      }
      await expect(commander.locator("[data-add-hero-passive-aura-effect]")).toBeDisabled();
      const authoredEffects = [
        ["additive_ratio", "0.25"],
        ["flat", "2"],
        ["multiplier", "1.1"],
        ["flat", "4"]
      ];
      for (const [index, [operation, value]] of authoredEffects.entries()) {
        await effects.nth(index).locator("[data-hero-passive-aura-effect-operation]").selectOption(operation);
        await effects.nth(index).locator("[data-hero-passive-aura-effect-value]").fill(value);
      }
      await effects.nth(3).locator("[data-remove-hero-passive-aura-effect]").click();
      await expect(effects).toHaveCount(3);
      await commander.locator("[data-add-hero-passive-aura-effect]").click();
      await expect(effects).toHaveCount(4);
      await effects.nth(3).locator("[data-hero-passive-aura-effect-value]").fill("4");

      const beforeInvalidPreview = readHeroesState(projectDir);
      await commander.locator("[data-hero-passive-aura-radius]").fill("65537");
      await page.locator("#btn-mechanics-preview").click();
      await expect(page.locator("#mechanics-preview-result")).toContainText(/radius|65.?536|range|maximum/i);
      await expect(page.locator("#mechanics-preview-result")).not.toContainText('"ok": true');
      expect(readHeroesState(projectDir)).toEqual(beforeInvalidPreview);

      await commander.locator("[data-hero-passive-aura-radius]").fill("4");
      await page.locator("#btn-mechanics-preview").click();
      await expect(page.locator("#mechanics-preview-result")).toContainText('"ok": true');
      expect(readHeroesState(projectDir)).toEqual(beforeInvalidPreview);
      await page.locator("#btn-mechanics-save").click();
      await expect.poll(() => readHeroesState(projectDir)).toMatchObject({
        moduleSchemaVersion: 6,
        enabled: true,
        selectedProfileId: "basic_hero_skill_tree",
        profile: {
          definitions: {
            commander: {
              passiveAura: {
                id: "field_command",
                label: "Field Command",
                radius: 4,
                effects: [
                  { kind: "modifier", scope: "tower_damage", modifier: { target: "damage", operation: "additive_ratio", value: 0.25 } },
                  { kind: "modifier", scope: "tower_damage", modifier: { target: "damage", operation: "flat", value: 2 } },
                  { kind: "modifier", scope: "tower_damage", modifier: { target: "damage", operation: "multiplier", value: 1.1 } },
                  { kind: "modifier", scope: "tower_damage", modifier: { target: "damage", operation: "flat", value: 4 } }
                ]
              }
            },
            hero_2: { passiveAura: null }
          }
        }
      });

      await page.reload();
      await openHeroesMechanics(page);
      await expect(page.locator('[data-hero-definition-id="commander"] [data-hero-passive-aura-label]'))
        .toHaveValue("Field Command");
      await expect(page.locator('[data-hero-definition-id="commander"] [data-hero-passive-aura-effect-row]'))
        .toHaveCount(4);
      const preservedProfile = structuredClone(readHeroesState(projectDir).profile);
      page.once("dialog", (dialog) => dialog.accept());
      await page.locator("#btn-mechanics-disable").click();
      await expect.poll(() => readHeroesState(projectDir)).toMatchObject({
        enabled: false,
        selectedProfileId: "basic_hero_skill_tree",
        profile: preservedProfile
      });
      await page.locator("#btn-mechanics-enable").click();
      await expect.poll(() => readHeroesState(projectDir)).toMatchObject({
        enabled: true,
        selectedProfileId: "basic_hero_skill_tree",
        profile: preservedProfile
      });
    } finally {
      fs.writeFileSync(balancePath, originalBalanceBytes, "utf8");
      if (originalMechanicsBytes === null) fs.rmSync(mechanicsPath, { force: true });
      else fs.writeFileSync(mechanicsPath, originalMechanicsBytes, "utf8");
    }
  });

  test("promotes every existing v5 profile through one Studio v6 save", async ({ page }) => {
    test.setTimeout(120_000);
    const balancePath = path.join(projectDir, "content", "balance.json");
    const mechanicsPath = path.join(projectDir, "content", "mechanics.json");
    const originalBalanceBytes = fs.readFileSync(balancePath, "utf8");
    const originalMechanicsBytes = fs.existsSync(mechanicsPath) ? fs.readFileSync(mechanicsPath, "utf8") : null;
    const definition = (label) => ({
      label, spawn: "core",
      movement: { movementProfileId: "ground", speed: 1 },
      durability: { maxHp: 100, shield: null },
      mana: { max: 100, starting: 60, regenerationPerUnit: 5 },
      activeAbility: {
        id: "arc_bolt", label: "Arc Bolt", target: "enemy",
        manaCost: 20, cooldown: 3, range: 6, damage: 30
      },
      skillTree: null
    });
    const movementProfiles = {
      ground: {
        label: "Ground", terrainMode: "respect_walkable",
        towerOccupancy: "blocked", defaultTerrainCost: 1000
      }
    };
    const beta = {
      selectedHeroId: "warden",
      definitions: { warden: definition("Beta Warden") },
      movementProfiles
    };
    try {
      const balance = JSON.parse(originalBalanceBytes);
      balance.missions.tutorial_01.mechanics = balance.missions.tutorial_01.mechanics ?? {};
      balance.missions.tutorial_01.mechanics.profiles = {
        ...(balance.missions.tutorial_01.mechanics.profiles ?? {}), heroes: "alpha"
      };
      fs.writeFileSync(balancePath, `${JSON.stringify(balance, null, 2)}\n`, "utf8");
      fs.writeFileSync(mechanicsPath, `${JSON.stringify({
        schemaVersion: 1,
        modules: {
          heroes: {
            schemaVersion: 5,
            enabled: true,
            profiles: {
              alpha: {
                selectedHeroId: "commander",
                definitions: { commander: definition("Alpha Commander") },
                movementProfiles
              },
              beta
            }
          }
        }
      }, null, 2)}\n`, "utf8");

      await openStudio(page, studioUrl);
      await openHeroesMechanics(page);
      const commander = page.locator('[data-hero-definition-id="commander"]');
      await commander.locator("[data-hero-passive-aura-enabled]").check();
      await page.locator("#btn-mechanics-save").click();
      await expect.poll(() => {
        const mechanics = JSON.parse(fs.readFileSync(mechanicsPath, "utf8"));
        return mechanics.modules.heroes;
      }).toMatchObject({
        schemaVersion: 6,
        profiles: {
          alpha: { definitions: { commander: { passiveAura: expect.any(Object) } } },
          beta: { definitions: { warden: { passiveAura: null } } }
        }
      });
      const persisted = JSON.parse(fs.readFileSync(mechanicsPath, "utf8"));
      expect(persisted.modules.heroes.profiles.beta).toEqual({
        ...beta,
        definitions: { warden: { ...beta.definitions.warden, passiveAura: null } }
      });
    } finally {
      fs.writeFileSync(balancePath, originalBalanceBytes, "utf8");
      if (originalMechanicsBytes === null) fs.rmSync(mechanicsPath, { force: true });
      else fs.writeFileSync(mechanicsPath, originalMechanicsBytes, "utf8");
    }
  });

  test("promotes all v6 profiles and preserves the full v7 blocking lifecycle", async ({ page }) => {
    test.setTimeout(120_000);
    const balancePath = path.join(projectDir, "content", "balance.json");
    const mechanicsPath = path.join(projectDir, "content", "mechanics.json");
    const originalBalanceBytes = fs.readFileSync(balancePath, "utf8");
    const originalMechanicsBytes = fs.existsSync(mechanicsPath)
      ? fs.readFileSync(mechanicsPath, "utf8")
      : null;
    const definition = (label) => ({
      label, spawn: "core",
      movement: { movementProfileId: "hero_ground", speed: 1 },
      durability: { maxHp: 100, shield: null },
      mana: { max: 100, starting: 60, regenerationPerUnit: 5 },
      activeAbility: {
        id: "arc_bolt", label: "Arc Bolt", target: "enemy",
        manaCost: 20, cooldown: 3, range: 6, damage: 30
      },
      skillTree: null,
      passiveAura: null
    });
    const heroMovementProfiles = {
      hero_ground: {
        label: "Hero Ground", terrainMode: "respect_walkable",
        towerOccupancy: "blocked", defaultTerrainCost: 1000
      }
    };
    const beta = {
      selectedHeroId: "warden",
      definitions: { warden: definition("Beta Warden") },
      movementProfiles: heroMovementProfiles
    };
    try {
      const balance = JSON.parse(originalBalanceBytes);
      balance.missions.tutorial_01.mechanics = balance.missions.tutorial_01.mechanics ?? {};
      balance.missions.tutorial_01.mechanics.profiles = {
        ...(balance.missions.tutorial_01.mechanics.profiles ?? {}),
        heroes: "alpha",
        navigation: "dynamic"
      };
      writeJson(balancePath, balance);
      writeJson(mechanicsPath, {
        schemaVersion: 1,
        modules: {
          navigation: {
            schemaVersion: 1,
            enabled: true,
            profiles: {
              dynamic: {
                mode: "dynamic_flow",
                defaultMovementProfileId: "ground",
                movementProfiles: {
                  ground: {
                    label: "Ground", terrainMode: "respect_walkable",
                    towerOccupancy: "blocked", defaultTerrainCost: 1000
                  },
                  flying: {
                    label: "Flying", terrainMode: "ignore_walkable",
                    towerOccupancy: "ignored", defaultTerrainCost: 1000
                  }
                },
                enemyMovementProfiles: Object.fromEntries(
                  Object.keys(balance.enemies).sort().map((enemyId) => [enemyId, "ground"])
                )
              }
            }
          },
          heroes: {
            schemaVersion: 6,
            enabled: true,
            profiles: {
              alpha: {
                selectedHeroId: "commander",
                definitions: {
                  commander: definition("Alpha Commander"),
                  sentinel: definition("Alpha Sentinel")
                },
                movementProfiles: heroMovementProfiles
              },
              beta
            }
          }
        }
      });

      await openStudio(page, studioUrl);
      await openHeroesMechanics(page);
      const commander = page.locator('[data-hero-definition-id="commander"]');
      await expect(commander.locator("[data-hero-blocking-enabled]")).not.toBeChecked();
      await commander.locator("[data-hero-blocking-enabled]").check();
      await commander.locator("[data-hero-block-capacity]").fill("65");
      const ids = commander.locator("[data-hero-blocking-movement-profile-id]");
      await expect(ids).toHaveCount(1);
      await ids.first().fill("ground");

      const beforeInvalid = fs.readFileSync(mechanicsPath, "utf8");
      await clickMechanicsPreviewAndWait(page);
      await expect(page.locator("#mechanics-preview-result"))
        .toContainText(/blockCapacity|capacity|64|maximum/i);
      await expect(page.locator("#mechanics-preview-result")).not.toContainText('"ok": true');
      expect(fs.readFileSync(mechanicsPath, "utf8")).toBe(beforeInvalid);

      await commander.locator("[data-hero-block-capacity]").fill("2");
      await commander.locator("[data-add-hero-blocking-movement-profile]").click();
      await expect(ids).toHaveCount(2);
      await ids.nth(1).fill("flying");
      await ids.nth(1).locator("xpath=..").locator("[data-remove-hero-blocking-movement-profile]").click();
      await expect(ids).toHaveCount(1);
      await commander.locator("[data-hero-block-capacity]").fill("2");
      await expect(commander.locator("[data-hero-block-capacity]")).toHaveValue("2");
      await clickMechanicsPreviewAndWait(page, '"ok": true');
      await expect(page.locator("#mechanics-preview-result")).toContainText('"ok": true');
      expect(fs.readFileSync(mechanicsPath, "utf8")).toBe(beforeInvalid);
      await page.locator("#btn-mechanics-save").click();

      await expect.poll(() => readHeroesState(projectDir)).toMatchObject({
        moduleSchemaVersion: 7,
        enabled: true,
        selectedProfileId: "alpha",
        profile: {
          definitions: {
            commander: {
              blocking: { blockCapacity: 2, movementProfileIds: ["ground"] }
            },
            sentinel: { blocking: null }
          }
        }
      });
      const persisted = readJson(mechanicsPath);
      expect(persisted.modules.heroes.profiles.beta).toEqual({
        ...beta,
        definitions: { warden: { ...beta.definitions.warden, blocking: null } }
      });

      await page.reload();
      await openHeroesMechanics(page);
      await expect(page.locator('[data-hero-definition-id="commander"] [data-hero-block-capacity]'))
        .toHaveValue("2");
      const preservedProfile = structuredClone(readHeroesState(projectDir).profile);
      page.once("dialog", (dialog) => dialog.accept());
      await page.locator("#btn-mechanics-disable").click();
      await expect.poll(() => readHeroesState(projectDir), { timeout: 30_000 }).toMatchObject({
        enabled: false,
        selectedProfileId: "alpha",
        profile: preservedProfile
      });
      await page.locator("#btn-mechanics-enable").click();
      await expect.poll(() => readHeroesState(projectDir), { timeout: 30_000 }).toMatchObject({
        enabled: true,
        selectedProfileId: "alpha",
        profile: preservedProfile
      });
    } finally {
      fs.writeFileSync(balancePath, originalBalanceBytes, "utf8");
      if (originalMechanicsBytes === null) fs.rmSync(mechanicsPath, { force: true });
      else fs.writeFileSync(mechanicsPath, originalMechanicsBytes, "utf8");
    }
  });

  test("enables, edits, reloads, disables, re-enables, and preserves future v8 read-only", async ({ page }) => {
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
    future.modules.heroes.schemaVersion = 8;
    future.modules.heroes.futureModuleRule = { preserve: ["exact", 8] };
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
    // A request already in flight when the fixture is replaced by future bytes may be rejected by
    // the revision guard. That expected 409 is the safety behavior under test, not a browser fault.
    expect(browserErrors().filter((message) => !(
      message.includes("Failed to load resource") && message.includes("409 (Conflict)")
    ))).toEqual([]);
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
      buildDurableHeroPlayerFixture(tempRoot, combination);
      buildAbilityHeroPlayerFixture(tempRoot, combination);
      buildSkillHeroPlayerFixture(tempRoot, combination);
      buildPassiveAuraHeroPlayerFixture(tempRoot, combination);
      buildBlockingHeroPlayerFixture(tempRoot, combination);
    }
    buildLegacyPlayerFixture(tempRoot);
    port = await freeHttpPort();
    server = http.createServer((request, response) => {
      const relative = decodeURIComponent(new URL(request.url, `http://127.0.0.1:${port}`).pathname)
        .replace(/^\/+/, "");
      const [mode, grid, renderer, ...parts] = relative.split("/");
      if (!(["active", "mobile", "durable", "ability", "skill", "aura", "blocking", "legacy"].includes(mode)
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
    await expect(page.locator("#hero-skill-tree")).toHaveCount(0);
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
        await expect(page.locator("#hero-action-bar")).toHaveCount(0);
        await expect(page.locator("#hero-skill-tree")).toHaveCount(0);

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

  for (const [index, { grid, renderer }] of combinations.entries()) {
    test(`moves, damages, and defeats the opt-in v3 hero on ${grid}/${renderer}`, async ({ page }) => {
      test.setTimeout(120_000);
      const browserErrors = captureBrowserErrors(page);
      await page.goto(playerUrl(port, "durable", grid, renderer));
      await waitForPlayerBoot(page);

      const initial = await inspectPlayer(page);
      expect(initial.heroes).toEqual({
        schemaVersion: 3,
        units: [{
          id: "commander",
          definitionId: "commander",
          label: "Durable Sentinel",
          coord: initial.coreCoord,
          movement: { targetCoord: null, nextCoord: null, edgeProgress: 0 },
          durability: {
            hp: 100,
            maxHp: 100,
            shield: { current: 25, capacity: 25 },
            defeated: false
          }
        }]
      });
      await expect(page.locator("#hero-action-bar")).toHaveCount(0);
      await expect(page.locator("#hero-skill-tree")).toHaveCount(0);
      await expect.poll(
        () => countHeroDurabilityPixels(page, renderer, initial.coreCoord, "healthy"),
        { message: `${grid}/${renderer} must draw HP/shield cues`, timeout: 10_000 }
      ).toBeGreaterThan(5);

      const inputFamily = mobileInputFamilies[index % mobileInputFamilies.length];
      if (inputFamily === "keyboard") {
        await assignHeroTargetWithKeyboard(page, initial.coreCoord, initial.spawnCoord, initial.heroes);
      } else {
        await assignHeroTargetWithPointer(page, inputFamily, initial.coreCoord, initial.spawnCoord);
      }
      await expect.poll(async () => {
        const hero = (await inspectPlayer(page)).heroes?.units?.[0];
        return hero?.movement?.targetCoord === null && coordinatesEqual(hero?.coord, initial.spawnCoord);
      }, {
        message: `${grid}/${renderer} v3 movement must reach its deterministic target`,
        timeout: 20_000
      }).toBe(true);

      await page.locator("#start-wave").click();
      await expect.poll(async () => (await inspectPlayer(page)).heroes?.units?.[0]?.durability, {
        message: `${grid}/${renderer} enemy towerAttack must defeat the v3 hero`,
        timeout: 20_000
      }).toEqual({
        hp: 0,
        maxHp: 100,
        shield: { current: 0, capacity: 25 },
        defeated: true
      });
      const defeated = (await inspectPlayer(page)).heroes.units[0];
      expect(defeated.movement).toEqual({ targetCoord: null, nextCoord: null, edgeProgress: 0 });
      await expect.poll(
        () => countHeroDurabilityPixels(page, renderer, defeated.coord, "defeated"),
        { message: `${grid}/${renderer} must draw the defeated cue`, timeout: 10_000 }
      ).toBeGreaterThan(5);
      expect(browserErrors()).toEqual([]);
    });
  }

  for (const { grid, renderer } of combinations) {
    for (const inputFamily of mobileInputFamilies) {
    test(`targets an enemy with ${inputFamily} using the opt-in v4 hero ability on ${grid}/${renderer}`, async ({ page }) => {
      test.setTimeout(120_000);
      const browserErrors = captureBrowserErrors(page);
      await page.goto(playerUrl(port, "ability", grid, renderer));
      await waitForPlayerBoot(page);

      const initial = await inspectPlayer(page);
      expect(initial.heroes).toEqual({
        schemaVersion: 4,
        units: [{
          id: "commander",
          definitionId: "commander",
          label: "Ability Sentinel",
          coord: initial.coreCoord,
          movement: { targetCoord: null, nextCoord: null, edgeProgress: 0 },
          durability: {
            hp: 100, maxHp: 100, shield: { current: 25, capacity: 25 }, defeated: false
          },
          mana: { current: 100, max: 100, regenerationPerUnit: 5 },
          activeAbility: {
            id: "arc_bolt", label: "Arc Bolt", target: "enemy", manaCost: 20,
            cooldown: 3, cooldownRemaining: 0, range: 65_536, damage: 30, ready: true
          }
        }]
      });
      const heroBar = page.locator("#hero-action-bar");
      const heroButton = heroBar.locator("button");
      await expect(heroBar).toBeVisible();
      await expect(heroBar).toHaveAttribute("data-mana-current", "100");
      await expect(heroButton).toContainText("Arc Bolt [1]");
      await expect(heroButton).toBeEnabled();
      await expect(page.locator("#hero-skill-tree")).toHaveCount(0);

      await page.locator("#start-wave").click();
      await expect.poll(async () => (await inspectPlayer(page)).enemies.length, {
        message: `${grid}/${renderer} must spawn a live ability target`, timeout: 15_000
      }).toBeGreaterThan(0);
      await page.locator("#speed").evaluate((element) => {
        element.value = "0";
        element.dispatchEvent(new Event("input", { bubbles: true }));
      });

      // Mutually-exclusive targeting: arming a mission ability cancels the hero ability and vice versa.
      await heroButton.click();
      await expect(heroButton).toHaveClass(/armed/);
      const missionAbility = page.locator('#ability-bar button[data-aid="path_water"]');
      await missionAbility.click();
      await expect(missionAbility).toHaveClass(/armed/);
      await expect(heroButton).not.toHaveClass(/armed/);
      await heroButton.click();
      await expect(heroButton).toHaveClass(/armed/);
      await expect(missionAbility).not.toHaveClass(/armed/);

      const manaBeforeEmptyTarget = (await inspectPlayer(page)).heroes.units[0].mana.current;
      const emptyPoint = await page.evaluate(() => window.__towerforgeTilePoint(window.__towerforgeInspect().coreCoord));
      await page.mouse.click(emptyPoint.x, emptyPoint.y);
      await expect(heroButton).toHaveClass(/armed/);
      expect((await inspectPlayer(page)).heroes.units[0].mana.current).toBe(manaBeforeEmptyTarget);
      await expect(page.locator("#message")).toContainText("live enemy");

      if (inputFamily === "keyboard") {
        await page.locator("#playfield").focus();
        await page.keyboard.press("Escape");
        await page.keyboard.press("Digit1");
        await moveKeyboardCursorTo(page, initial.spawnCoord);
        await page.keyboard.press("Enter");
      } else {
        const enemyPoint = await page.evaluate(() => {
          const enemy = window.__towerforgeInspect().enemies[0];
          return window.__towerforgeEnemyPoint(enemy.id);
        });
        if (inputFamily === "touch") await page.touchscreen.tap(enemyPoint.x, enemyPoint.y);
        else await page.mouse.click(enemyPoint.x, enemyPoint.y);
      }

      await expect.poll(async () => (await inspectPlayer(page)).heroes.units[0], {
        message: `${grid}/${renderer} ${inputFamily} must dispatch exact v5`, timeout: 10_000
      }).toMatchObject({
        mana: { current: 80, max: 100, regenerationPerUnit: 5 },
        activeAbility: { cooldownRemaining: 3, ready: false }
      });
      await expect(heroBar).toHaveAttribute("data-mana-current", "80");
      await expect(heroBar).toHaveAttribute("data-cooldown-remaining", "3");
      await expect(heroButton).toBeDisabled();
      await expect(heroButton).toContainText("(3)");
      expect(browserErrors()).toEqual([]);
    });
    }
  }

  for (const { grid, renderer } of combinations) {
    for (const inputFamily of mobileInputFamilies) {
      test(`unlocks the authoritative v5 hero skill with ${inputFamily} on ${grid}/${renderer}`, async ({ page }) => {
        test.setTimeout(90_000);
        const browserErrors = captureBrowserErrors(page);
        await page.goto(playerUrl(port, "skill", grid, renderer));
        await waitForPlayerBoot(page);

        const initial = await inspectPlayer(page);
        expect(initial.heroes).toMatchObject({
          schemaVersion: 5,
          units: [{
            id: "commander",
            skills: {
              availablePoints: 1,
              startingPoints: 1,
              pointsPerInterwave: 1,
              maximumEarnablePoints: expect.any(Number),
              managementAvailable: true,
              nodes: [{
                id: "focused_cast",
                requiresSkillIds: [],
                missingRequirementIds: [],
                unlocked: false,
                unlockable: true
              }, {
                id: "overcharge",
                requiresSkillIds: ["focused_cast"],
                missingRequirementIds: ["focused_cast"],
                unlocked: false,
                unlockable: false
              }]
            }
          }]
        });
        const skillTree = page.locator("#hero-skill-tree");
        const skillButton = skillTree.locator('button[data-hero-skill-id="focused_cast"]');
        await expect(skillTree).toBeVisible();
        await expect(skillTree).toHaveAttribute("data-available-points", "1");
        await expect(skillButton).toBeEnabled();

        if (inputFamily === "touch") {
          const box = await skillButton.boundingBox();
          expect(box).toBeTruthy();
          await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
        } else if (inputFamily === "keyboard") {
          await skillButton.focus();
          await page.keyboard.press("Enter");
        } else {
          await skillButton.click();
        }

        await expect.poll(async () => (await inspectPlayer(page)).heroes?.units?.[0]?.skills)
          .toMatchObject({
            availablePoints: 0,
            managementAvailable: true,
            nodes: [{ id: "focused_cast", unlocked: true, unlockable: false }, {
              id: "overcharge", missingRequirementIds: [], unlocked: false, unlockable: false
            }]
          });
        await expect(skillTree).toHaveAttribute("data-available-points", "0");
        await expect(skillButton).toBeDisabled();
        expect((await inspectPlayer(page)).lastEvents).toEqual(expect.arrayContaining([
          expect.objectContaining({
            type: "heroSkillUnlocked",
            heroId: "commander",
            skillId: "focused_cast",
            cost: 1,
            previousPoints: 1,
            currentPoints: 0
          })
        ]));
        expect(browserErrors()).toEqual([]);
      });
    }
  }

  for (const { grid, renderer } of combinations) {
    test(`presents authoritative v6 aura membership through build, sell, and defeat on ${grid}/${renderer}`, async ({ page }) => {
      test.setTimeout(120_000);
      const browserErrors = captureBrowserErrors(page);
      await page.goto(playerUrl(port, "aura", grid, renderer));
      await waitForPlayerBoot(page);

      const initial = await inspectPlayer(page);
      expect(initial.heroes).toMatchObject({
        schemaVersion: 6,
        units: [{
          id: "commander",
          definitionId: "commander",
          skills: null,
          passiveAura: {
            id: "command_link",
            label: "Command Link",
            radius: 65_536,
            active: true,
            affectedTowerIds: []
          }
        }]
      });
      await expect(page.getByRole("button", { name: /command link/i })).toHaveCount(0);

      const buildPoint = await page.evaluate(() => {
        const snapshot = window.__towerforgeInspect();
        const tile = snapshot.tiles.find((candidate) => candidate.terrain === "buildable" && !candidate.occupiedBy);
        return window.__towerforgeTilePoint({ q: tile.q, r: tile.r });
      });
      await page.mouse.click(buildPoint.x, buildPoint.y);
      await expect.poll(async () => (await inspectPlayer(page)).towers.length, {
        message: `${grid}/${renderer} must place an ordinary tower`, timeout: 10_000
      }).toBe(1);
      const placed = (await inspectPlayer(page)).towers[0];
      await expect.poll(async () => (
        (await inspectPlayer(page)).heroes?.units?.[0]?.passiveAura?.affectedTowerIds
      )).toEqual([placed.id]);

      await page.locator("#sell-mode").click();
      const towerPoint = await page.evaluate((coord) => window.__towerforgeTilePoint(coord), placed.coord);
      await page.mouse.click(towerPoint.x, towerPoint.y);
      await expect.poll(async () => (await inspectPlayer(page)).towers.length).toBe(0);
      await expect.poll(async () => (
        (await inspectPlayer(page)).heroes?.units?.[0]?.passiveAura?.affectedTowerIds
      )).toEqual([]);

      await page.locator("#start-wave").click();
      await expect.poll(async () => (
        (await inspectPlayer(page)).heroes?.units?.[0]?.durability?.defeated
      ), {
        message: `${grid}/${renderer} enemy towerAttack must defeat the aura hero`, timeout: 20_000
      }).toBe(true);
      await expect.poll(async () => (
        (await inspectPlayer(page)).heroes?.units?.[0]?.passiveAura
      )).toMatchObject({ active: false, affectedTowerIds: [] });
      expect(browserErrors()).toEqual([]);
    });
  }

  for (const { grid, renderer } of combinations) {
    test(`presents authoritative v7 hero holds and release on ${grid}/${renderer} without new input`, async ({ page }) => {
      test.setTimeout(120_000);
      const browserErrors = captureBrowserErrors(page);
      await page.goto(playerUrl(port, "blocking", grid, renderer));
      await waitForPlayerBoot(page);

      const initial = await inspectPlayer(page);
      expect(initial.navigation).toMatchObject({ schemaVersion: 1, mode: "dynamic_flow" });
      expect(initial.heroes).toMatchObject({
        schemaVersion: 7,
        units: [{
          id: "commander",
          definitionId: "commander",
          skills: null,
          passiveAura: null,
          blocking: { blockCapacity: 2, active: true, blockedEnemyIds: [] }
        }]
      });
      await expect(page.locator('[data-hero-blocking], #hero-blocking, [data-hero-block-button]'))
        .toHaveCount(0);

      await assignHeroTargetWithPointer(
        page,
        "mouse",
        initial.heroes.units[0].coord,
        initial.spawnCoord
      );
      await expect.poll(async () => {
        const hero = (await inspectPlayer(page)).heroes?.units?.[0];
        return hero?.movement?.targetCoord === null && coordinatesEqual(hero?.coord, initial.spawnCoord);
      }, { timeout: 20_000 }).toBe(true);

      await page.locator("#start-wave").click();
      await expect.poll(async () => (
        (await inspectPlayer(page)).heroes?.units?.[0]?.blocking?.blockedEnemyIds
      ), {
        message: `${grid}/${renderer} must publish an engine-owned hold`, timeout: 20_000
      }).toHaveLength(1);
      const held = (await inspectPlayer(page)).heroes.units[0].blocking.blockedEnemyIds;
      expect(held).toEqual([...held].sort());
      expect((await inspectPlayer(page)).enemies.map((enemy) => enemy.id)).toContain(held[0]);

      await expect.poll(async () => (
        (await inspectPlayer(page)).heroes?.units?.[0]?.durability?.defeated
      ), {
        message: `${grid}/${renderer} held enemy must retain ordinary attack phases`, timeout: 20_000
      }).toBe(true);
      await expect.poll(async () => (
        (await inspectPlayer(page)).heroes?.units?.[0]?.blocking
      )).toEqual({ blockCapacity: 2, active: false, blockedEnemyIds: [] });
      expect(browserErrors()).toEqual([]);
    });
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

function buildDurableHeroPlayerFixture(root, { grid, renderer }) {
  const name = `hero_durable_${grid}_${renderer}`;
  const { projectDir } = createProject({ name, parentDir: root, templateName: "classic", gridKind: grid });
  const manifestPath = path.join(projectDir, "project.json");
  const manifest = readJson(manifestPath);
  manifest.schemaVersion = 3;
  writeJson(manifestPath, manifest);

  const balancePath = path.join(projectDir, "content", "balance.json");
  const balance = readJson(balancePath);
  const missionId = balance.defaultMissionId ?? Object.keys(balance.missions)[0];
  balance.missions[missionId].mechanics = { profiles: { heroes: "durable_commanders" } };
  for (const enemy of Object.values(balance.enemies)) {
    enemy.maxHp = Math.max(enemy.maxHp, 1_000);
    enemy.speed = 0.01;
    enemy.towerAttack = { interval: 0.05, damage: 70, range: 100 };
  }
  writeJson(balancePath, balance);
  writeJson(path.join(projectDir, "content", "mechanics.json"), {
    schemaVersion: 1,
    modules: {
      heroes: {
        schemaVersion: 3,
        enabled: true,
        profiles: {
          durable_commanders: {
            selectedHeroId: "commander",
            definitions: {
              commander: {
                label: "Durable Sentinel",
                spawn: "core",
                movement: { movementProfileId: "ground", speed: 20 },
                durability: { maxHp: 100, shield: { capacity: 25 } }
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

function buildAbilityHeroPlayerFixture(root, { grid, renderer }) {
  const name = `hero_ability_${grid}_${renderer}`;
  const { projectDir } = createProject({ name, parentDir: root, templateName: "classic", gridKind: grid });
  const manifestPath = path.join(projectDir, "project.json");
  const manifest = readJson(manifestPath);
  manifest.schemaVersion = 3;
  writeJson(manifestPath, manifest);

  const balancePath = path.join(projectDir, "content", "balance.json");
  const balance = readJson(balancePath);
  const missionId = balance.defaultMissionId ?? Object.keys(balance.missions)[0];
  balance.missions[missionId].mechanics = { profiles: { heroes: "ability_commanders" } };
  balance.abilities.path_water = {
    id: "path_water", label: "Water Path", cooldown: 60, duration: 20, radius: 3
  };
  balance.missions[missionId].abilityIds = ["path_water"];
  for (const enemy of Object.values(balance.enemies)) {
    enemy.maxHp = Math.max(enemy.maxHp, 1_000);
    enemy.speed = 0.01;
  }
  writeJson(balancePath, balance);
  writeJson(path.join(projectDir, "content", "mechanics.json"), {
    schemaVersion: 1,
    modules: {
      heroes: {
        schemaVersion: 4,
        enabled: true,
        profiles: {
          ability_commanders: {
            selectedHeroId: "commander",
            definitions: {
              commander: {
                label: "Ability Sentinel",
                spawn: "core",
                movement: { movementProfileId: "ground", speed: 2 },
                durability: { maxHp: 100, shield: { capacity: 25 } },
                mana: { max: 100, starting: 100, regenerationPerUnit: 5 },
                activeAbility: {
                  id: "arc_bolt", label: "Arc Bolt", target: "enemy", manaCost: 20,
                  cooldown: 3, range: 65_536, damage: 30
                }
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

function buildSkillHeroPlayerFixture(root, { grid, renderer }) {
  const name = `hero_skill_${grid}_${renderer}`;
  const { projectDir } = createProject({ name, parentDir: root, templateName: "classic", gridKind: grid });
  const manifestPath = path.join(projectDir, "project.json");
  const manifest = readJson(manifestPath);
  manifest.schemaVersion = 3;
  writeJson(manifestPath, manifest);

  const balancePath = path.join(projectDir, "content", "balance.json");
  const balance = readJson(balancePath);
  const missionId = balance.defaultMissionId ?? Object.keys(balance.missions)[0];
  balance.missions[missionId].mechanics = { profiles: { heroes: "skill_commanders" } };
  writeJson(balancePath, balance);
  writeJson(path.join(projectDir, "content", "mechanics.json"), {
    schemaVersion: 1,
    modules: {
      heroes: {
        schemaVersion: 5,
        enabled: true,
        profiles: {
          skill_commanders: {
            selectedHeroId: "commander",
            definitions: {
              commander: {
                label: "Skill Commander",
                spawn: "core",
                movement: { movementProfileId: "ground", speed: 2 },
                durability: { maxHp: 100, shield: { capacity: 25 } },
                mana: { max: 100, starting: 100, regenerationPerUnit: 5 },
                activeAbility: {
                  id: "arc_bolt", label: "Arc Bolt", target: "enemy", manaCost: 20,
                  cooldown: 3, range: 65_536, damage: 30
                },
                skillTree: {
                  points: { starting: 1, perInterwave: 1 },
                  nodes: {
                    focused_cast: {
                      label: "Focused Cast",
                      description: "Increase active ability damage.",
                      cost: 1,
                      requires: [],
                      effects: [{
                        kind: "modifier",
                        scope: "hero_ability_damage",
                        modifier: { target: "damage", operation: "multiplier", value: 1.25 }
                      }]
                    },
                    overcharge: {
                      label: "Overcharge",
                      description: "Further increase active ability damage.",
                      cost: 2,
                      requires: ["focused_cast"],
                      effects: [{
                        kind: "modifier",
                        scope: "hero_ability_damage",
                        modifier: { target: "damage", operation: "additive_ratio", value: 0.5 }
                      }]
                    }
                  }
                }
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

function buildPassiveAuraHeroPlayerFixture(root, { grid, renderer }) {
  const name = `hero_aura_${grid}_${renderer}`;
  const { projectDir } = createProject({ name, parentDir: root, templateName: "classic", gridKind: grid });
  const manifestPath = path.join(projectDir, "project.json");
  const manifest = readJson(manifestPath);
  manifest.schemaVersion = 3;
  writeJson(manifestPath, manifest);

  const balancePath = path.join(projectDir, "content", "balance.json");
  const balance = readJson(balancePath);
  const missionId = balance.defaultMissionId ?? Object.keys(balance.missions)[0];
  balance.missions[missionId].mechanics = { profiles: { heroes: "aura_commanders" } };
  for (const enemy of Object.values(balance.enemies)) {
    enemy.maxHp = Math.max(enemy.maxHp, 1_000);
    enemy.speed = 0.01;
    enemy.towerAttack = { interval: 0.05, damage: 100, range: 100 };
  }
  writeJson(balancePath, balance);
  writeJson(path.join(projectDir, "content", "mechanics.json"), {
    schemaVersion: 1,
    modules: {
      heroes: {
        schemaVersion: 6,
        enabled: true,
        profiles: {
          aura_commanders: {
            selectedHeroId: "commander",
            definitions: {
              commander: {
                label: "Aura Commander",
                spawn: "core",
                movement: { movementProfileId: "ground", speed: 2 },
                durability: { maxHp: 100, shield: { capacity: 25 } },
                mana: { max: 100, starting: 100, regenerationPerUnit: 5 },
                activeAbility: {
                  id: "arc_bolt", label: "Arc Bolt", target: "enemy", manaCost: 20,
                  cooldown: 3, range: 65_536, damage: 30
                },
                skillTree: null,
                passiveAura: {
                  id: "command_link",
                  label: "Command Link",
                  radius: 65_536,
                  effects: [{
                    kind: "modifier",
                    scope: "tower_damage",
                    modifier: { target: "damage", operation: "additive_ratio", value: 0.2 }
                  }]
                }
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

function buildBlockingHeroPlayerFixture(root, { grid, renderer }) {
  const name = `hero_blocking_${grid}_${renderer}`;
  const { projectDir } = createProject({
    name, parentDir: root, templateName: "classic", gridKind: grid
  });
  const manifestPath = path.join(projectDir, "project.json");
  const manifest = readJson(manifestPath);
  manifest.schemaVersion = 3;
  writeJson(manifestPath, manifest);

  const balancePath = path.join(projectDir, "content", "balance.json");
  const balance = readJson(balancePath);
  const missionId = balance.defaultMissionId ?? Object.keys(balance.missions)[0];
  balance.missions[missionId].mechanics = {
    profiles: { navigation: "dynamic", heroes: "blocking_commanders" }
  };
  for (const enemy of Object.values(balance.enemies)) {
    enemy.maxHp = Math.max(enemy.maxHp, 1_000);
    enemy.speed = 0.01;
    enemy.towerAttack = { interval: 0.5, damage: 20, range: 100 };
  }
  const enemyMovementProfiles = Object.fromEntries(
    Object.keys(balance.enemies).sort().map((enemyId) => [enemyId, "ground"])
  );
  writeJson(balancePath, balance);
  writeJson(path.join(projectDir, "content", "mechanics.json"), {
    schemaVersion: 1,
    modules: {
      navigation: {
        schemaVersion: 1,
        enabled: true,
        profiles: {
          dynamic: {
            mode: "dynamic_flow",
            defaultMovementProfileId: "ground",
            movementProfiles: {
              ground: {
                label: "Ground", terrainMode: "respect_walkable",
                towerOccupancy: "blocked", defaultTerrainCost: 1_000
              }
            },
            enemyMovementProfiles
          }
        }
      },
      heroes: {
        schemaVersion: 7,
        enabled: true,
        profiles: {
          blocking_commanders: {
            selectedHeroId: "commander",
            definitions: {
              commander: {
                label: "Blocking Commander",
                spawn: "core",
                movement: { movementProfileId: "hero_ground", speed: 20 },
                durability: { maxHp: 100, shield: { capacity: 25 } },
                mana: { max: 100, starting: 100, regenerationPerUnit: 5 },
                activeAbility: {
                  id: "arc_bolt", label: "Arc Bolt", target: "enemy", manaCost: 20,
                  cooldown: 3, range: 65_536, damage: 30
                },
                skillTree: null,
                passiveAura: null,
                blocking: { blockCapacity: 2, movementProfileIds: ["ground"] }
              }
            },
            movementProfiles: {
              hero_ground: {
                label: "Hero Ground", terrainMode: "respect_walkable",
                towerOccupancy: "blocked", defaultTerrainCost: 1_000
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

async function countHeroDurabilityPixels(page, renderer, heroCoord, state) {
  const canvas = renderer === "phaser" ? page.locator("#playfield canvas") : page.locator("canvas#playfield");
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const [box, point, screenshot] = await Promise.all([
    canvas.boundingBox(),
    page.evaluate((coord) => window.__towerforgeTilePoint(coord), heroCoord),
    canvas.screenshot()
  ]);
  if (!box || !point) return 0;
  const png = PNG.sync.read(screenshot);
  const centerX = Math.round((point.x - box.x) * png.width / box.width);
  const centerY = Math.round((point.y - box.y) * png.height / box.height);
  const radius = Math.max(18, Math.round(38 * png.width / box.width));
  let count = 0;
  for (let y = Math.max(0, centerY - radius); y < Math.min(png.height, centerY + radius); y += 1) {
    for (let x = Math.max(0, centerX - radius); x < Math.min(png.width, centerX + radius); x += 1) {
      const offset = (y * png.width + x) * 4;
      const red = png.data[offset];
      const green = png.data[offset + 1];
      const blue = png.data[offset + 2];
      const alpha = png.data[offset + 3];
      const healthy = alpha > 128 && (
        (green > 175 && red >= 90 && red < 160 && blue >= 95 && blue < 170)
        || (blue > 220 && green > 190 && red < 130)
      );
      const defeated = alpha > 128 && red > 190 && green >= 65 && green < 135 && blue >= 55 && blue < 120;
      if ((state === "healthy" && healthy) || (state === "defeated" && defeated)) count += 1;
    }
  }
  return count;
}

function coordinatesEqual(left, right) {
  return Boolean(left && right && left.q === right.q && left.r === right.r);
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

async function clickMechanicsPreviewAndWait(page, expectedText) {
  const responsePromise = page.waitForResponse((response) => (
    response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/mechanics/preview"
  ), { timeout: 45_000 });
  await page.locator("#btn-mechanics-preview").click();
  await responsePromise;
  const output = page.locator("#mechanics-preview-result");
  if (expectedText !== undefined) {
    await expect(output).toContainText(expectedText, { timeout: 45_000 });
  } else {
    await expect(output).not.toHaveText(
      "Preview changes before applying them.",
      { timeout: 45_000 }
    );
  }
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
