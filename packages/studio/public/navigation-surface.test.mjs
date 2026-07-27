import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const html = fs.readFileSync(path.resolve("packages/studio/public/index.html"), "utf8");
const app = fs.readFileSync(path.resolve("packages/studio/public/app.js"), "utf8");
const server = fs.readFileSync(path.resolve("packages/studio/server.mjs"), "utf8");

function functionSource(source, name) {
  const start = source.search(new RegExp(`function\\s+${name}\\s*\\(`));
  expect(start, `missing function ${name}`).toBeGreaterThanOrEqual(0);
  if (start < 0) return "";
  let depth = 0;
  let opened = false;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === "{") { depth += 1; opened = true; }
    if (source[index] === "}") depth -= 1;
    if (opened && depth === 0) return source.slice(start, index + 1);
  }
  return source.slice(start);
}

describe("R2.5 Studio navigation Mechanics Hub surface", () => {
  it("updates the shared editor heading when the Dynamic Navigation card is selected", () => {
    const renderHub = functionSource(app, "renderMechanicsHub");

    expect(html).toContain('id="mechanics-combat-title"');
    expect(renderHub).toMatch(
      /\$\(["']mechanics-combat-title["']\)[\s\S]{0,240}(?:textContent|innerHTML)[\s\S]{0,240}mechanicsSelectedModuleLabel/,
      "the visible editor heading must follow the selected module instead of retaining the static Deep combat label"
    );
  });

  it("keeps every navigation authoring control inside Mechanics Hub", () => {
    const mechanicsStart = html.indexOf('<section id="tab-mechanics"');
    const mechanicsEnd = html.indexOf('<section id="tab-settings"', mechanicsStart);
    expect(mechanicsStart).toBeGreaterThanOrEqual(0);
    expect(mechanicsEnd).toBeGreaterThan(mechanicsStart);
    const mechanicsMarkup = html.slice(mechanicsStart, mechanicsEnd);
    const outside = `${html.slice(0, mechanicsStart)}${html.slice(mechanicsEnd)}`;
    for (const id of [
      "mechanics-navigation-editor",
      "mechanics-navigation-mode",
      "mechanics-navigation-default-profile",
      "mechanics-navigation-movement-profile-rows",
      "mechanics-navigation-enemy-profile-rows",
      "btn-mechanics-add-movement-profile",
      "mechanics-navigation-overlay-toggle",
      "mechanics-navigation-overlay-state"
    ]) {
      expect(mechanicsMarkup, `${id} must live in Mechanics Hub`).toContain(`id="${id}"`);
      expect(outside, `${id} must not clutter primary entity/mission forms`).not.toContain(`id="${id}"`);
      expect(html.match(new RegExp(`id=["']${id}["']`, "g")) ?? []).toHaveLength(1);
    }
  });

  it("normalizes, edits, saves, reloads, disables, and re-enables exact navigation profiles", () => {
    const render = functionSource(app, "renderMechanicsNavigationEditor");
    const normalize = functionSource(app, "normalizeNavigationMechanicsDraft");
    const update = functionSource(app, "updateMechanicsNavigationDraft");
    const load = functionSource(app, "loadMechanicsProfile");
    const apply = functionSource(app, "applyMechanics");

    expect(render).toMatch(/authored_routes/);
    expect(render).toMatch(/dynamic_flow/);
    for (const field of [
      "defaultMovementProfileId",
      "movementProfiles",
      "enemyMovementProfiles",
      "terrainMode",
      "towerOccupancy",
      "defaultTerrainCost",
      "terrainCosts"
    ]) {
      expect(`${normalize}\n${update}\n${render}`).toContain(field);
    }
    expect(load).toMatch(/normalizeNavigationMechanicsDraft/);
    expect(load).toMatch(/moduleSchemaVersion|schemaVersion/);
    expect(apply).toMatch(/ifRevision\s*:\s*preview\.revision/);
    expect(apply).toMatch(/await\s+load\(\)/);
    expect(apply).not.toMatch(/delete\s+[^;]*(?:movementProfiles|enemyMovementProfiles|terrainCosts)/);
  });

  it("atomically remaps the default and enemy assignments when a movement profile ID is renamed", () => {
    const updateSource = functionSource(app, "updateMechanicsNavigationDraft");
    const mechanicsUI = {
      draft: {
        mode: "dynamic_flow",
        defaultMovementProfileId: "floating",
        movementProfiles: {
          ground: {
            label: "Ground",
            terrainMode: "respect_walkable",
            towerOccupancy: "blocked",
            defaultTerrainCost: 1000
          },
          floating: {
            label: "Floating",
            terrainMode: "ignore_walkable",
            towerOccupancy: "blocked",
            defaultTerrainCost: 1200
          }
        },
        enemyMovementProfiles: { swift_runner: "floating" }
      },
      preview: { revision: "stale" }
    };
    const movementRow = (oldId, newId, definition) => ({
      dataset: { profileId: oldId },
      querySelector(selector) {
        const values = {
          "[data-navigation-profile-id]": { value: newId },
          "[data-navigation-profile-label]": { value: definition.label },
          "[data-navigation-terrain-mode]": { value: definition.terrainMode },
          "[data-navigation-tower-occupancy]": { value: definition.towerOccupancy },
          "[data-navigation-default-terrain-cost]": { value: String(definition.defaultTerrainCost) },
          "[data-navigation-terrain-costs]": { value: "" }
        };
        return values[selector] ?? null;
      }
    });
    const rows = [
      movementRow("ground", "ground", mechanicsUI.draft.movementProfiles.ground),
      movementRow("floating", "amphibious", mechanicsUI.draft.movementProfiles.floating)
    ];
    const enemyRow = {
      dataset: { enemyId: "swift_runner" },
      querySelector: () => ({ value: "floating" })
    };
    const documentStub = {
      querySelectorAll(selector) {
        if (selector.includes("movement-profile-rows")) return rows;
        if (selector.includes("enemy-profile-rows")) return [enemyRow];
        return [];
      }
    };
    const elementValues = {
      "mechanics-navigation-mode": "dynamic_flow",
      "mechanics-navigation-default-profile": "floating"
    };
    const element = (id) => elementValues[id] === undefined ? null : { value: elementValues[id] };
    const run = new Function(
      "MechanicsUI",
      "document",
      "$",
      "ownDataValue",
      "defineOwnDataValue",
      `"use strict"; ${updateSource}; updateMechanicsNavigationDraft();`
    );

    run(
      mechanicsUI,
      documentStub,
      element,
      (object, key) => object && Object.prototype.hasOwnProperty.call(object, key) ? object[key] : undefined,
      (object, key, value) => Object.defineProperty(object, key, {
        value,
        enumerable: true,
        configurable: true,
        writable: true
      })
    );

    expect(mechanicsUI.draft.defaultMovementProfileId).toBe("amphibious");
    expect(mechanicsUI.draft.enemyMovementProfiles).toEqual({ swift_runner: "amphibious" });
    expect(mechanicsUI.preview).toBeNull();
  });

  it("routes navigation through an isolated detached normalizer without combat or reaction fallthrough", () => {
    const route = functionSource(app, "normalizeMechanicsDraft");
    const normalize = functionSource(app, "normalizeNavigationMechanicsDraft");
    const navigationBranch = route.indexOf('selectedModuleId === "navigation"');
    const reactionsBranch = route.indexOf('selectedModuleId === "reactions"');

    expect(navigationBranch).toBeGreaterThanOrEqual(0);
    expect(route).toContain("normalizeNavigationMechanicsDraft");
    expect(reactionsBranch).toBeGreaterThanOrEqual(0);
    expect(navigationBranch).toBeLessThan(reactionsBranch);
    expect(normalize).toMatch(/const\s+draft\s*=\s*deep\s*\(/);
    expect(normalize).not.toMatch(/MechanicsUI|S\.project|normalizeMechanicsDraft/);
    expect(normalize).not.toMatch(/shields|damageTypes|armorTypes|marks|exposures|reactions/);
    expect(normalize).not.toMatch(/\bprofile\s*(?:\.|\[)[^;\n]*=/);
  });

  it("requests engine-owned viewport analysis and clears/recomputes overlay across lifecycle changes", () => {
    const refresh = functionSource(app, "refreshNavigationOverlay");
    const clear = functionSource(app, "clearNavigationOverlay");
    expect(server).toMatch(/\/api\/navigation\/analyze/);
    expect(refresh).toMatch(/\/api\/navigation\/analyze/);
    expect(refresh).toMatch(/coordinates|viewport/);
    expect(refresh).toMatch(/towerTypeId/);
    expect(refresh).toMatch(/placementRows|buildability/);
    expect(clear).toMatch(/navigation.*overlay|overlay.*navigation/i);
    expect(app).toMatch(/applyMechanics[\s\S]*clearNavigationOverlay[\s\S]*refreshNavigationOverlay/);
    expect(app).toMatch(/(?:mission|tower|map)[\s\S]{0,300}refreshNavigationOverlay/i);
    expect(app).toMatch(/module_disabled|mode_inactive|authored_routes/);
  });

  it("uses a deterministic interaction-centered bounded overlay window and reports partial coverage", () => {
    const viewportSource = functionSource(app, "navigationOverlayViewportCoordinates");
    const refreshSource = functionSource(app, "refreshNavigationOverlay");
    const selectCoordinates = new Function(
      "PT",
      `"use strict"; ${viewportSource}; return navigationOverlayViewportCoordinates();`
    );
    const tiles = Array.from({ length: 5_001 }, (_, q) => ({ q, r: 0 }));
    const anchor = { q: 5_000, r: 0 };
    const run = (orderedTiles) => selectCoordinates({
      keyboardCoord: anchor,
      game: { getSnapshot: () => ({ tiles: orderedTiles }) }
    });

    const forward = run(tiles);
    const reversed = run([...tiles].reverse());
    expect(forward).toHaveLength(4_096);
    expect(forward).toContainEqual(anchor);
    expect(new Set(forward.map(({ q, r }) => `${q},${r}`)))
      .toEqual(new Set(reversed.map(({ q, r }) => `${q},${r}`)));

    const small = tiles.slice(0, 128);
    expect(run(small)).toEqual(small.map(({ q, r }) => ({ q, r })));
    expect(viewportSource).not.toMatch(/\.slice\(\s*0\s*,\s*4096\s*\)/);
    expect(`${viewportSource}\n${refreshSource}`).toMatch(
      /(?:partial|coverage|showing|window)[\s\S]{0,300}(?:coordinates\.length|selectedCount|analyzedCount)[\s\S]{0,300}(?:tiles\.length|totalCount|totalTiles)/i,
      "the Hub must tell authors when only a bounded subset of a large visible map was analyzed"
    );
  });

  it("preflights Studio pointer, touch, and keyboard placement before mutation", () => {
    const action = functionSource(app, "actAtPlaytestCoord");
    const canPlace = action.indexOf("canPlaceTower");
    const place = action.indexOf("placeTower");

    expect(canPlace, "Studio must query the authoritative engine placement contract before mutation")
      .toBeGreaterThanOrEqual(0);
    expect(place).toBeGreaterThan(canPlace);
    expect(action).toMatch(/canPlaceTower[\s\S]{0,500}(?:ok|reason)[\s\S]{0,500}placeTower/);
  });

  it("re-centers the large-map overlay immediately after keyboard movement or a rejected click", () => {
    const sync = functionSource(app, "syncPlaytestKeyboardCoord");
    const move = functionSource(app, "movePlaytestKeyboardCoord");
    const action = functionSource(app, "actAtPlaytestCoord");
    const anchorUpdate = sync.indexOf("PT.keyboardCoord");
    const invalidate = sync.indexOf("clearNavigationOverlay", anchorUpdate);
    const refresh = sync.indexOf("refreshNavigationOverlay", invalidate);

    expect(anchorUpdate).toBeGreaterThanOrEqual(0);
    expect(invalidate, "changing the interaction anchor must invalidate the previous bounded coordinate window")
      .toBeGreaterThan(anchorUpdate);
    expect(refresh, "the overlay must be recomputed for the new pointer/keyboard anchor immediately")
      .toBeGreaterThan(invalidate);
    expect(move).toContain("syncPlaytestKeyboardCoord");

    const syncCall = action.indexOf("syncPlaytestKeyboardCoord");
    const preflight = action.indexOf("canPlaceTower");
    const rejectedReturn = action.indexOf("return", preflight);
    expect(syncCall).toBeGreaterThanOrEqual(0);
    expect(preflight).toBeGreaterThan(syncCall);
    expect(rejectedReturn, "a rejected click must return only after sync invalidated/refreshed its focus window")
      .toBeGreaterThan(preflight);
  });
});
