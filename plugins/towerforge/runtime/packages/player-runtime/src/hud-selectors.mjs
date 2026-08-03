export const HUD_SELECTOR_DESCRIPTOR_SCHEMA_VERSION = 1;

export const HUD_SELECTOR_DESCRIPTORS_V1 = Object.freeze([
  { schemaVersion: 1, id: "buildOptions", valueType: "item", cardinality: "many" },
  { schemaVersion: 1, id: "abilityOptions", valueType: "item", cardinality: "many" },
  { schemaVersion: 1, id: "inventoryItems", valueType: "item", cardinality: "many" },
  { schemaVersion: 1, id: "questItems", valueType: "item", cardinality: "many" },
  { schemaVersion: 1, id: "capabilityItems", valueType: "item", cardinality: "many" },
  { schemaVersion: 1, id: "statusText", valueType: "string", cardinality: "one" },
  { schemaVersion: 1, id: "playerGold", valueType: "number", cardinality: "one" },
  { schemaVersion: 1, id: "coreHp", valueType: "number", cardinality: "one" },
  { schemaVersion: 1, id: "waveProgress", valueType: "number", cardinality: "one" },
  { schemaVersion: 1, id: "isVictory", valueType: "boolean", cardinality: "one" },
  { schemaVersion: 1, id: "isDefeat", valueType: "boolean", cardinality: "one" }
].map(Object.freeze));

function item(id, labelKey, index, enabled = true, extra = {}) {
  return Object.freeze({ id, labelKey, index, enabled, ...extra });
}

/** Converts an authoritative snapshot plus presentation-only context into the closed HUD selector
 * vocabulary. It never mutates the snapshot and deliberately exposes no arbitrary object paths. */
export function createHudSelectorStateV1(snapshot = {}, context = {}) {
  const buildIds = Array.isArray(context.buildTowerIds) ? context.buildTowerIds : [];
  const towerDefinitions = context.towers && typeof context.towers === "object" ? context.towers : {};
  const buildOptions = buildIds.map((id, index) => item(
    String(id), String(towerDefinitions[id]?.label ?? id), index, towerDefinitions[id] !== undefined,
    { towerTypeId: String(id) }
  ));
  const abilities = snapshot.abilities && typeof snapshot.abilities === "object"
    ? Object.values(snapshot.abilities) : [];
  const abilityOptions = abilities.map((ability, index) => item(
    String(ability.id ?? index), String(ability.label ?? ability.id ?? index), index,
    ability.available !== false, { abilityId: String(ability.id ?? index) }
  ));
  const inventory = snapshot.roguelite?.artifacts?.inventory ?? snapshot.arsenal?.inventory ?? [];
  const inventoryItems = Array.isArray(inventory) ? inventory.map((entry, index) => item(
    String(entry.instanceId ?? entry.id ?? index),
    String(entry.label ?? entry.definitionId ?? entry.id ?? index), index, true
  )) : [];
  const quests = snapshot.quests?.entries ?? snapshot.questState?.entries ?? [];
  const questItems = Array.isArray(quests) ? quests.map((entry, index) => item(
    String(entry.questId ?? entry.id ?? index), String(entry.label ?? entry.questId ?? entry.id ?? index),
    index, entry.status !== "failed", { status: String(entry.status ?? "active") }
  )) : [];
  const capabilityIds = Array.isArray(context.capabilityIds) ? [...context.capabilityIds].sort() : [];
  const capabilityItems = capabilityIds.map((id, index) => item(String(id), String(id), index));
  const resources = snapshot.resources && typeof snapshot.resources === "object" ? snapshot.resources : {};
  const preferredCurrency = typeof context.primaryCurrencyId === "string" ? context.primaryCurrencyId : null;
  const firstResourceId = Object.keys(resources).sort()[0];
  const playerGold = Number(resources[preferredCurrency] ?? resources.gold ?? resources[firstResourceId] ?? 0);
  const totalWaves = Number(snapshot.totalWaves ?? 0);
  const startedWaves = Number(snapshot.startedWaveCount ?? 0);
  return Object.freeze({
    selectors: Object.freeze({
      buildOptions: Object.freeze(buildOptions),
      abilityOptions: Object.freeze(abilityOptions),
      inventoryItems: Object.freeze(inventoryItems),
      questItems: Object.freeze(questItems),
      capabilityItems: Object.freeze(capabilityItems),
      statusText: String(context.statusText ?? ""),
      playerGold: Number.isFinite(playerGold) ? playerGold : 0,
      coreHp: Number.isFinite(snapshot.coreHp) ? snapshot.coreHp : 0,
      waveProgress: totalWaves > 0 ? Math.max(0, Math.min(1, startedWaves / totalWaves)) : 0,
      isVictory: snapshot.outcome === "victory",
      isDefeat: snapshot.outcome === "defeat"
    }),
    nodeStates: Object.freeze({})
  });
}
