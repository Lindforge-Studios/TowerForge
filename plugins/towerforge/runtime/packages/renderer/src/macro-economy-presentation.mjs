const INACTIVE = Object.freeze({ active: false, profileId: null, managementAllowed: false, ritualAllowed: false, quoteCurrencyId: null, commodities: Object.freeze([]), deposits: Object.freeze([]), depositProducts: Object.freeze([]), altars: Object.freeze([]) });

function plain(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    if (Object.getPrototypeOf(value) !== Object.prototype) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.getOwnPropertySymbols(descriptors).length) return null;
    const result = {};
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!descriptor.enumerable || !("value" in descriptor)) return null;
      result[key] = descriptor.value;
    }
    return result;
  } catch { return null; }
}

function dense(value, maximum) {
  if (!Array.isArray(value) || value.length > maximum) return null;
  try {
    if (Object.getPrototypeOf(value) !== Array.prototype || Object.keys(Object.getOwnPropertyDescriptors(value)).length !== value.length + 1) return null;
    return value.map((_, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      return descriptor?.enumerable && "value" in descriptor ? descriptor.value : undefined;
    });
  } catch { return null; }
}

const text = (value) => typeof value === "string" && value.length > 0 && value.length <= 256 ? value : null;
const number = (value) => typeof value === "number" && Number.isFinite(value) ? value : null;

export function projectMacroEconomyPresentation(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || !("macroEconomy" in snapshot)) return INACTIVE;
  const section = plain(snapshot.macroEconomy);
  const market = section && plain(section.market);
  const commodities = market && dense(market.commodities, 32);
  const deposits = section && dense(section.deposits, 1024);
  const products = section && dense(section.depositProducts, 32);
  const altars = section && dense(section.altars, 32);
  if (!section || section.schemaVersion !== 1 || !text(section.profileId) || typeof section.managementAllowed !== "boolean" || typeof section.ritualAllowed !== "boolean"
    || !text(section.quoteCurrencyId) || !market || !Number.isSafeInteger(market.lastPriceWaveIndex)
    || !commodities || !deposits || !products || !altars) return undefined;
  const projectedCommodities = commodities.map((value) => {
    const row = plain(value);
    return row && text(row.id) && text(row.label) && number(row.quote) !== null && Number.isSafeInteger(row.holding)
      && Number.isSafeInteger(row.pendingNetDemand)
      ? Object.freeze({ id: row.id, label: row.label, quote: row.quote, holding: row.holding, pendingNetDemand: row.pendingNetDemand }) : null;
  });
  const projectedDeposits = deposits.map((value) => {
    const row = plain(value);
    return row && text(row.instanceId) && text(row.depositId) && text(row.label) && text(row.currencyId)
      && number(row.principal) !== null && Number.isSafeInteger(row.maturityClearedWave)
      ? Object.freeze({ instanceId: row.instanceId, depositId: row.depositId, label: row.label, currencyId: row.currencyId, principal: row.principal, maturityClearedWave: row.maturityClearedWave }) : null;
  });
  const projectedProducts = products.map((value) => {
    const row = plain(value);
    return row && text(row.id) && text(row.label) && text(row.currencyId) && Number.isSafeInteger(row.durationClearedWaves)
      && Number.isSafeInteger(row.interestBasisPoints) && number(row.minAmount) !== null && number(row.maxAmount) !== null
      ? Object.freeze({ id: row.id, label: row.label, currencyId: row.currencyId, durationClearedWaves: row.durationClearedWaves, interestBasisPoints: row.interestBasisPoints, minAmount: row.minAmount, maxAmount: row.maxAmount }) : null;
  });
  const projectedAltars = altars.map((value) => {
    const row = plain(value);
    return row && text(row.id) && text(row.label) && Number.isSafeInteger(row.minTowers) && Number.isSafeInteger(row.maxTowers)
      ? Object.freeze({ id: row.id, label: row.label, minTowers: row.minTowers, maxTowers: row.maxTowers }) : null;
  });
  if ([...projectedCommodities, ...projectedDeposits, ...projectedProducts, ...projectedAltars].some((entry) => entry === null)) return undefined;
  return Object.freeze({ active: true, profileId: section.profileId, managementAllowed: section.managementAllowed, ritualAllowed: section.ritualAllowed, quoteCurrencyId: section.quoteCurrencyId, lastPriceWaveIndex: market.lastPriceWaveIndex, commodities: Object.freeze(projectedCommodities), deposits: Object.freeze(projectedDeposits), depositProducts: Object.freeze(projectedProducts), altars: Object.freeze(projectedAltars) });
}
