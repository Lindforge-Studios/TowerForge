import { resolveActiveCombatMechanics } from "../content/combat-mechanics.js";
/**
 * Compatibility wrapper retained for checkpoint/shield callers. The shared combat normalizer
 * accepts both combat v1 (shields only) and v2 (shields plus armor).
 */
export function resolveActiveCombatShieldDefinitions(content, missionId) {
    return resolveActiveCombatMechanics(content, missionId)?.shields;
}
