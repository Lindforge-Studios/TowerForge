import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const html = fs.readFileSync(path.resolve("packages/studio/public/index.html"), "utf8");
const app = fs.readFileSync(path.resolve("packages/studio/public/app.js"), "utf8");
const server = fs.readFileSync(path.resolve("packages/studio/server.mjs"), "utf8");
const moduleIds = [
  "combat",
  "reactions",
  "navigation",
  "elevation",
  "physics",
  "roguelite",
  "heroes",
  "logistics",
  "director",
  "scriptingDx",
  "multiplayer"
];

describe("Mechanics Studio Hub surface", () => {
  it("keeps the Hub reachable and renders module cards from runtime capabilities", () => {
    const nav = openingTagWithAttribute("data-tab", "mechanics");
    expect(nav).not.toContain('aria-disabled="true"');
    expect(nav).not.toMatch(/\sdisabled(?:[\s=>]|$)/);
    expect(html).toContain('id="tab-mechanics"');
    expect(app).toMatch(/\["mechanics",\s*"Mechanics"\]/);
    expect(html).toContain('id="mechanics-module-grid"');
    expect(app).toMatch(/function\s+renderMechanicsHub/);
    expect(app).toContain("/api/mechanics/capabilities");
    expect(app).toMatch(/capabilit(?:y|ies)[\s\S]{0,300}available/);
    expect(app).toMatch(/data-mechanics-module/);

    const staticCombatCard = html.match(/<[^>]+data-mechanics-module="combat"[^>]*>/i)?.[0];
    if (staticCombatCard) {
      expect(staticCombatCard).not.toContain('data-status="planned"');
      expect(staticCombatCard).not.toContain('aria-disabled="true"');
    }
    for (const moduleId of moduleIds) expect(app).toContain(`"${moduleId}"`);
  });

  it("provides mission/profile controls, typed shield rows, and guarded lifecycle actions", () => {
    for (const id of [
      "mechanics-mission-select",
      "mechanics-profile-id",
      "mechanics-enemy-shield-rows",
      "mechanics-tower-shield-rows",
      "btn-mechanics-preview",
      "btn-mechanics-enable",
      "btn-mechanics-save",
      "btn-mechanics-disable"
    ]) {
      expect(`${html}\n${app}`).toContain(id);
    }
    expect(app).toMatch(/data-shield-target=["']enemy["']/);
    expect(app).toMatch(/data-shield-target=["']tower["']/);
    for (const field of ["capacity", "ratePerUnit", "delayAfterDamage"]) expect(app).toContain(field);
    expect(app).toContain("/api/mechanics/preview");
    expect(app).toContain("/api/mechanics/apply");
    expect(app).toMatch(/ifRevision[\s\S]{0,300}(?:preview|mechanics)/i);
    expect(app).toMatch(/await\s+load\(\)/);
  });

  it("keeps the v2 damage, armor-matrix, and enemy-assignment editors isolated inside Mechanics Hub", () => {
    const mechanicsStart = html.indexOf('<section id="tab-mechanics"');
    const mechanicsEnd = html.indexOf('<section id="tab-settings"', mechanicsStart);
    expect(mechanicsStart).toBeGreaterThanOrEqual(0);
    expect(mechanicsEnd).toBeGreaterThan(mechanicsStart);
    const mechanicsMarkup = html.slice(mechanicsStart, mechanicsEnd);

    for (const id of [
      "mechanics-damage-type-rows",
      "mechanics-armor-type-rows",
      "mechanics-enemy-armor-rows",
      "btn-mechanics-add-damage-type",
      "btn-mechanics-add-armor-type"
    ]) {
      expect(mechanicsMarkup, `${id} must live in Mechanics Hub`).toContain(`id="${id}"`);
      expect(html.match(new RegExp(`id=["']${id}["']`, "g")) ?? []).toHaveLength(1);
    }
    expect(mechanicsMarkup).toMatch(/damage types/i);
    expect(mechanicsMarkup).toMatch(/armor types|armor matrix/i);
    expect(mechanicsMarkup).toMatch(/enemy armor/i);

    for (const marker of [
      "data-damage-type-id",
      "data-armor-type-id",
      "data-armor-multiplier",
      "data-enemy-armor-id",
      "damageTypes",
      "armorTypes",
      "armorAssignments"
    ]) expect(app).toContain(marker);

    const normalizeBody = functionSource(app, "normalizeMechanicsDraft");
    expect(normalizeBody).toMatch(/damageTypes/);
    expect(normalizeBody).toMatch(/armorTypes/);
    expect(normalizeBody).toMatch(/armorAssignments/);
    const requestBody = functionSource(app, "mechanicsRequest");
    expect(requestBody).toMatch(/moduleSchemaVersion/);
    expect(requestBody).toMatch(/MechanicsUI\.(?:moduleSchemaVersion|draft)/);
  });

  it("keeps v3 mark definitions and source bindings in a dedicated Mechanics Hub editor", () => {
    const mechanicsStart = html.indexOf('<section id="tab-mechanics"');
    const mechanicsEnd = html.indexOf('<section id="tab-settings"', mechanicsStart);
    const mechanicsMarkup = html.slice(mechanicsStart, mechanicsEnd);

    for (const id of [
      "mechanics-mark-definition-rows",
      "mechanics-mark-binding-rows",
      "btn-mechanics-add-mark"
    ]) {
      expect(mechanicsMarkup, `${id} must live in Mechanics Hub`).toContain(`id="${id}"`);
      expect(html.match(new RegExp(`id=["']${id}["']`, "g")) ?? []).toHaveLength(1);
    }
    for (const marker of [
      "data-mark-id",
      "data-mark-duration",
      "data-mark-max-stacks",
      "data-mark-multiplier",
      "data-mark-consume-policy",
      "data-mark-damage-type",
      "data-mark-binding-source",
      "basic_vulnerability_marks"
    ]) expect(app).toContain(marker);

    const normalizeBody = functionSource(app, "normalizeMechanicsDraft");
    expect(normalizeBody).toMatch(/marks/);
    expect(normalizeBody).toMatch(/definitions/);
    expect(normalizeBody).toMatch(/bindings/);
    const requestBody = functionSource(app, "mechanicsRequest");
    expect(requestBody).toMatch(/moduleSchemaVersion/);
    expect(requestBody).toMatch(/MechanicsUI\.(?:moduleSchemaVersion|draft)/);
  });

  it("keeps reactions v1 exposure, predicate, consumption, and effect authoring inside Mechanics Hub", () => {
    const mechanicsStart = html.indexOf('<section id="tab-mechanics"');
    const mechanicsEnd = html.indexOf('<section id="tab-settings"', mechanicsStart);
    const mechanicsMarkup = html.slice(mechanicsStart, mechanicsEnd);

    for (const id of [
      "mechanics-reaction-editor",
      "mechanics-exposure-definition-rows",
      "mechanics-exposure-application-rows",
      "mechanics-reaction-definition-rows",
      "btn-mechanics-add-exposure",
      "btn-mechanics-add-reaction"
    ]) {
      expect(mechanicsMarkup, `${id} must live in Mechanics Hub`).toContain(`id="${id}"`);
      expect(html.match(new RegExp(`id=["']${id}["']`, "g")) ?? []).toHaveLength(1);
    }
    for (const marker of [
      "data-exposure-id",
      "data-exposure-duration",
      "data-exposure-max-stacks",
      "data-exposure-damage-type",
      "data-reaction-id",
      "data-reaction-trigger-damage-type",
      "data-reaction-requirement-kind",
      "data-reaction-consume",
      "data-reaction-effect-target",
      "data-reaction-effect-amount-kind",
      "suppressTriggerExposureApplications",
      "allowReactions",
      "elemental_shatter",
      "wet_chain_shock",
      "poison_combustion"
    ]) expect(app).toContain(marker);

    expect(app).toMatch(/MechanicsUI\.capabilities\?\.reactions\?\.authoring|MechanicsUI\.capabilities\.reactions\.authoring/);
    expect(app).toMatch(/function\s+renderMechanicsReactionEditors/);
    expect(app).toMatch(/function\s+normalizeReactionMechanicsDraft/);
    const requestBody = functionSource(app, "mechanicsRequest");
    expect(requestBody).toMatch(/moduleId|selectedModuleId/);
    expect(requestBody).toMatch(/reactions|MechanicsUI\.draft/);
  });

  it("[verifier] preserves unedited multi-trigger, multi-requirement, and multi-effect reaction data", () => {
    const rowBody = functionSource(app, "mechanicsReactionDefinitionRowHtml");
    const updateBody = functionSource(app, "updateMechanicsReactionRow");

    expect(rowBody).not.toMatch(/damageTypes\?\.\[0\]/);
    expect(rowBody).not.toMatch(/requirements\?\.\[0\]/);
    expect(updateBody).not.toMatch(/damageTypes\s*:\s*\[/);
    expect(updateBody).not.toMatch(/requirements\s*:\s*\[\s*requirement\s*\]/);
    expect(updateBody).not.toMatch(/effects\s*:\s*\{\s*\[effectId\]/);
  });

  it("[verifier] exposes typed Studio CRUD for every authored reaction requirement and effect", () => {
    const rowBody = functionSource(app, "mechanicsReactionDefinitionRowHtml");

    expect(rowBody).not.toMatch(/\[\s*firstRequirement\s*\]\s*=\s*authoredRequirements/);
    expect(rowBody).toMatch(/authoredRequirements[\s\S]*\.map\(/);
    expect(rowBody).toMatch(/Object\.(?:entries|keys)\([^)]*effects/);
    for (const marker of [
      "data-add-reaction-requirement",
      "data-remove-reaction-requirement",
      "data-reaction-requirement-min-stacks",
      "data-add-reaction-effect",
      "data-remove-reaction-effect"
    ]) expect(`${html}\n${app}`).toContain(marker);
    const updateBody = functionSource(app, "updateMechanicsReactionRow");
    expect(updateBody).toMatch(/minStacks/);
    expect(updateBody).toMatch(/delete\s+requirement\.minStacks/);
  });

  it("surfaces reaction prerequisites and preserves combat while reactions disable and re-enable", () => {
    const hubBody = functionSource(app, "renderMechanicsHub");
    expect(hubBody).toMatch(/unmetPrerequisites|prerequisite/i);
    expect(hubBody).toMatch(/dependency_missing|reaction_terrain_tag_missing/);
    const applyBody = functionSource(app, "applyMechanics");
    expect(applyBody).not.toMatch(/delete\s+[^;]*(?:combat|damageTypes|terrainTypes)/);
    expect(applyBody).toMatch(/ifRevision\s*:\s*preview\.revision/);
    expect(applyBody).toMatch(/await\s+load\(\)/);
  });

  it("reloads persisted v2 profiles after save and preserves the selected module version across disable/re-enable", () => {
    const loadBody = functionSource(app, "loadMechanicsProfile");
    expect(loadBody).toMatch(/normalizeMechanicsDraft\(profile\)/);
    expect(loadBody).toMatch(/moduleSchemaVersion|schemaVersion/);

    const applyBody = functionSource(app, "applyMechanics");
    expect(applyBody).toMatch(/await\s+apiPost\(["']\/api\/mechanics\/apply["']/);
    expect(applyBody).toMatch(/ifRevision\s*:\s*preview\.revision/);
    expect(applyBody).toMatch(/await\s+load\(\)/);
    expect(applyBody).not.toMatch(/delete\s+[^;]*(?:profile|damageTypes|armorTypes|armorAssignments)/);

    const hubBody = functionSource(app, "renderMechanicsHub");
    expect(hubBody).toMatch(/btn-mechanics-disable[\s\S]*applyMechanics\(false\)/);
    expect(hubBody).toMatch(/btn-mechanics-enable[\s\S]*applyMechanics\(true\)/);
  });

  it("never downgrades an existing combat v2 module when starting from a v1 shield recipe", () => {
    const effectiveVersionBody = functionSource(app, "mechanicsEffectiveModuleSchemaVersion");
    expect(effectiveVersionBody).toMatch(/mechanicsProjectModuleVersion|moduleSchemaVersion/);
    expect(effectiveVersionBody).toMatch(/(?:Math\.max|===\s*2|>=\s*2)/);

    const newProfileBody = functionSource(app, "newMechanicsProfile");
    expect(newProfileBody).toMatch(/mechanicsProjectModuleVersion|mechanicsEffectiveModuleSchemaVersion|Math\.max/);
    expect(newProfileBody).not.toMatch(
      /MechanicsUI\.moduleSchemaVersion\s*=\s*recipe\.entity\.moduleSchemaVersion\s*===\s*2\s*\?\s*2\s*:\s*1/
    );
  });

  it("preserves combat v3 when loading, saving, disabling, or re-enabling a mark profile", () => {
    const effectiveVersionBody = functionSource(app, "mechanicsEffectiveModuleSchemaVersion");
    expect(effectiveVersionBody).toMatch(/mechanicsProjectModuleVersion/);
    expect(effectiveVersionBody).toMatch(/mechanicsDraftUsesMarks|\.marks/);
    expect(effectiveVersionBody).toMatch(/Math\.max|>=\s*3|===\s*3/);

    const loadBody = functionSource(app, "loadMechanicsProfile");
    expect(loadBody).toMatch(/normalizeMechanicsDraft\(profile\)/);
    expect(loadBody).toMatch(/moduleSchemaVersion|schemaVersion/);
    const applyBody = functionSource(app, "applyMechanics");
    expect(applyBody).not.toMatch(/delete\s+[^;]*(?:marks|definitions|bindings)/);
  });

  it("does not upgrade a loaded v1 shield draft merely because the recipe dropdown points at armor v2", () => {
    const effectiveVersionBody = functionSource(app, "mechanicsEffectiveModuleSchemaVersion");
    expect(effectiveVersionBody).toMatch(/mechanicsProjectModuleVersion/);
    expect(effectiveVersionBody).toMatch(/MechanicsUI\.moduleSchemaVersion/);
    expect(effectiveVersionBody).toMatch(/mechanicsDraftUsesArmor/);
    expect(effectiveVersionBody).not.toMatch(/MechanicsUI\.recipe|recipeVersion|recipeId/);

    const newProfileBody = functionSource(app, "newMechanicsProfile");
    expect(newProfileBody).toMatch(/recipe\.entity\.moduleSchemaVersion/);
    expect(newProfileBody).toMatch(/MechanicsUI\.draft\s*=\s*normalizeMechanicsDraft\(recipe\.entity\.profile\)/);

    const hubBody = functionSource(app, "renderMechanicsHub");
    const recipeChange = hubBody.match(/recipeSelect\.onchange\s*=\s*\(\)\s*=>\s*\{([\s\S]*?)\n\s*\};/);
    expect(recipeChange, "recipe dropdown change handler must be explicit").not.toBeNull();
    expect(recipeChange[1]).not.toMatch(/moduleSchemaVersion|MechanicsUI\.draft/);
  });

  it("derives armor editor limits and numeric input bounds from the engine-owned combat descriptor", () => {
    expect(app).toMatch(/MechanicsUI\.capabilities\?\.combat\?\.authoring|MechanicsUI\.capabilities\.combat\.authoring/);
    expect(app).toMatch(/function\s+mechanicsAuthoringLimits/);
    expect(app).not.toMatch(/const\s+MECHANICS_UI_LIMITS\s*=/);

    const damageRowBody = functionSource(app, "mechanicsDamageTypeRowHtml");
    const armorRowBody = functionSource(app, "mechanicsArmorTypeRowHtml");
    const renderArmorBody = functionSource(app, "renderMechanicsArmorEditors");
    expect(damageRowBody).not.toContain('maxlength="128"');
    expect(armorRowBody).not.toContain('max="1000000"');
    expect(`${damageRowBody}\n${armorRowBody}\n${renderArmorBody}`).toMatch(/mechanicsAuthoringLimits|limits\./);
    expect(renderArmorBody).not.toContain("MECHANICS_UI_LIMITS");
    expect(renderArmorBody).not.toMatch(/matrixEntriesRemaining|damageTypes\.slice\([^)]*matrixEntries/);
    expect(renderArmorBody).toMatch(/mechanicsArmorTypeRowHtml\(id,\s*definition,\s*damageTypes\)/);
    expect(renderArmorBody).toMatch(/!hadOverride[\s\S]*limits\.matrixEntries[\s\S]*mechanicsAuthoredMatrixEntryCount/);
    expect(functionSource(app, "mechanicsAuthoredMatrixEntryCount")).toMatch(/Object\.keys\([^)]*multipliers/);
  });

  it("lists authored profiles and replaces a draft only through explicit load or new-profile actions", () => {
    expect(html).toMatch(/<select[^>]+id="mechanics-profile-select"/i);
    expect(html).toContain('id="btn-mechanics-load-profile"');
    expect(html).toContain('id="btn-mechanics-new-profile"');
    expect(app).toMatch(/loadedProfileId/);
    expect(app).toMatch(/function\s+loadMechanicsProfile/);
    expect(app).toMatch(/function\s+newMechanicsProfile/);
    expect(app).toMatch(/profileIds/);
    expect(app).toMatch(/(?:already exists|existing profile|overwrite)/i);
  });

  it("disables mechanics write buttons while ordinary Studio edits are dirty", () => {
    const body = functionSource(app, "renderMechanicsHub");
    const dirtyGuard = body.match(/const\s+([A-Za-z_$][\w$]*)\s*=\s*[^;]*S\.dirty[^;]*;/);
    expect(dirtyGuard, "renderMechanicsHub must derive an explicit dirty write guard").not.toBeNull();
    const guardName = dirtyGuard[1];
    for (const id of ["btn-mechanics-enable", "btn-mechanics-save", "btn-mechanics-disable"]) {
      const assignment = body.match(new RegExp(`\\$\\("${id}"\\)\\.disabled\\s*=\\s*([^;]+)`));
      expect(assignment, `missing disabled assignment for ${id}`).not.toBeNull();
      expect(assignment[1], `${id} must include the dirty write guard`).toContain(guardName);
    }
  });

  it("cannot preview one mechanics draft and apply a silently changed draft", () => {
    const applyBody = functionSource(app, "applyMechanics");
    const previewCall = applyBody.match(/await\s+previewMechanics\(([^)]*)\)/);
    const previewIndex = previewCall ? applyBody.indexOf(previewCall[0]) : -1;
    const snapshot = applyBody.match(/const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:Object\.freeze\s*\(\s*)?mechanicsRequest\(enabled\)/);
    const snapshotIsReused = Boolean(
      snapshot
      && previewIndex > applyBody.indexOf(snapshot[0])
      && previewCall?.[1].includes(snapshot[1])
      && applyBody.slice(previewIndex).match(new RegExp(`apiPost\\([\\s\\S]*?\\.\\.\\.${snapshot[1]}(?:[,}])`))
      && !applyBody.slice(previewIndex).includes("mechanicsRequest(enabled)")
    );

    const hubBody = functionSource(app, "renderMechanicsHub");
    const rowsBody = functionSource(app, "mechanicsShieldRowHtml");
    const editorIsLocked = /MechanicsUI\.applying[\s\S]*missionSelect\.disabled/.test(hubBody)
      && /MechanicsUI\.applying[\s\S]*mechanics-profile-id/.test(hubBody)
      && /MechanicsUI\.applying[\s\S]*disabled/.test(rowsBody);

    expect(snapshotIsReused || editorIsLocked,
      "capture one request before preview and reuse it for apply, or lock every mechanics input while applying")
      .toBe(true);
  });

  it("scrubs private transaction metadata only at the response root so legal nested IDs survive", () => {
    const body = functionSource(server, "sanitizeMechanicsResponse");
    expect(body).toMatch(/depth\s*===\s*0[\s\S]*MECHANICS_PRIVATE_RESPONSE_KEYS\.has\(key\)/);
    for (const id of ["backup", "projectDir", "backupPath"]) expect(body).not.toContain(`key === "${id}"`);
  });
});

function openingTagWithAttribute(name, value) {
  const match = html.match(new RegExp(`<[^>]+${name}="${value}"[^>]*>`, "i"));
  expect(match, `missing [${name}="${value}"]`).not.toBeNull();
  return match[0];
}

function functionSource(source, name) {
  const start = source.indexOf(`function ${name}`);
  expect(start, `missing function ${name}`).toBeGreaterThanOrEqual(0);
  const opening = source.indexOf("{", start);
  let depth = 0;
  for (let index = opening; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unterminated function ${name}`);
}
