import { ROGUELITE_DAMAGE_MODIFIER_RESERVE, resolveActiveRogueliteMechanics, rogueliteSynergyWorstCaseModifierCount } from "../content/roguelite-mechanics.js";
/**
 * Upper bound for one tower's run-stage modifier fan-in during a campaign battle.
 * The same policy guards preparation, direct construction, and checkpoint restore.
 */
export function campaignBattleWorstCaseModifierCount(deck, content, missionId) {
    const active = resolveActiveRogueliteMechanics(content, missionId);
    if (!active)
        return 0;
    const mission = content.missions[missionId];
    if (!mission)
        return 0;
    let maximum = 0;
    for (const towerTypeId of mission.buildTowerIds) {
        const tags = new Set(active.towerTagsByTypeId[towerTypeId] ?? []);
        let count = rogueliteSynergyWorstCaseModifierCount(active.synergies);
        const matchingDraftEffects = (cardId) => {
            if (!active.draft || !Object.prototype.hasOwnProperty.call(active.draft.definitions, cardId))
                return 0;
            const definition = active.draft.definitions[cardId];
            if (!definition)
                return 0;
            return definition.effects.filter((effect) => (effect.scope.kind === "all_towers"
                || (effect.scope.kind === "tower_type" && effect.scope.towerTypeId === towerTypeId)
                || (effect.scope.kind === "tower_tag" && tags.has(effect.scope.tag)))).length;
        };
        for (const entry of deck)
            count += matchingDraftEffects(entry.cardId);
        const localWorstPerChoice = Object.keys(active.draft?.definitions ?? {}).reduce((worst, cardId) => Math.max(worst, matchingDraftEffects(cardId)), 0);
        count += Math.max(0, mission.waves.length - 1) * localWorstPerChoice;
        for (const slot of active.artifacts?.towerSlots[towerTypeId] ?? []) {
            count += Object.values(active.artifacts?.definitions ?? {}).reduce((worst, definition) => (definition.slotType === slot.slotType ? Math.max(worst, definition.modifiers.length) : worst), 0);
        }
        count += ROGUELITE_DAMAGE_MODIFIER_RESERVE.total;
        maximum = Math.max(maximum, count);
    }
    return maximum;
}
