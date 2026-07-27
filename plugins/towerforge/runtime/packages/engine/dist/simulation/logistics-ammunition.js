import { LOGISTICS_AMMUNITION_LIMITS } from "../content/logistics-mechanics.js";
function compareBinary(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
export function isLiveLogisticsAmmunitionTower(tower) {
    return tower.hp === undefined || tower.hp > 0;
}
export function isAmmunitionBoundTowerType(ammunition, towerTypeId) {
    return Object.prototype.hasOwnProperty.call(ammunition.towerInventories, towerTypeId);
}
export function getLogisticsAmmunitionTowerInventory(ammunition, towerTypeId) {
    return isAmmunitionBoundTowerType(ammunition, towerTypeId)
        ? ammunition.towerInventories[towerTypeId]
        : undefined;
}
export function assertLogisticsAmmunitionPlacement(ammunition, towers, candidateTypeId) {
    if (!isAmmunitionBoundTowerType(ammunition, candidateTypeId))
        return;
    let live = 1;
    for (const tower of towers) {
        if (isLiveLogisticsAmmunitionTower(tower)
            && isAmmunitionBoundTowerType(ammunition, tower.typeId))
            live += 1;
        if (live > LOGISTICS_AMMUNITION_LIMITS.liveInventories) {
            throw new Error(`Logistics ammunition live inventory limit ${LOGISTICS_AMMUNITION_LIMITS.liveInventories} exceeded.`);
        }
    }
}
export function buildLogisticsAmmunitionSnapshotV2(ammunition, towers, amounts) {
    const inventories = towers
        .filter((tower) => isLiveLogisticsAmmunitionTower(tower)
        && isAmmunitionBoundTowerType(ammunition, tower.typeId))
        .sort((left, right) => compareBinary(left.id, right.id))
        .map((tower) => {
        const definition = getLogisticsAmmunitionTowerInventory(ammunition, tower.typeId);
        if (!definition) {
            throw new Error(`Logistics ammunition definition for tower type "${tower.typeId}" is missing.`);
        }
        const amount = amounts.get(tower.id);
        if (amount === undefined) {
            throw new Error(`Logistics ammunition inventory for tower "${tower.id}" is missing.`);
        }
        return Object.freeze({
            towerId: tower.id,
            towerTypeId: tower.typeId,
            ammoTypeId: definition.ammoTypeId,
            amount,
            capacity: definition.capacity,
            consumptionPerActivation: definition.consumptionPerActivation,
            hasRequiredAmmo: amount >= definition.consumptionPerActivation
        });
    });
    if (inventories.length > LOGISTICS_AMMUNITION_LIMITS.liveInventories) {
        throw new Error(`Logistics ammunition live inventory limit ${LOGISTICS_AMMUNITION_LIMITS.liveInventories} exceeded.`);
    }
    return Object.freeze({ inventories: Object.freeze(inventories) });
}
