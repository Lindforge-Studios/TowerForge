import { resolveActiveRogueliteMechanics } from "../content/roguelite-mechanics.js";
import { recordPlayerMissionClear } from "../profile/player-profile.js";
import { MAX_MODIFIERS_PER_RESOLUTION } from "../simulation/modifiers.js";
import { canonicalStringify, getSimulationContentDigest, stableDigest } from "../simulation/stable-digest.js";
import { TowerDefenseGame } from "../simulation/TowerDefenseGame.js";
import { CAMPAIGN_RUN_LIMITS, decodeCampaignRun } from "./campaign-run.js";
import { campaignBattleWorstCaseModifierCount, preflightHeroAuraDamageFinite } from "./campaign-battle-policy.js";
import { validateCampaignRunAgainstContent } from "./campaign-world.js";
function isBattleNode(node) {
    return Boolean(node
        && typeof node === "object"
        && "type" in node
        && (node.type === "battle" || node.type === "elite" || node.type === "boss")
        && "missionId" in node);
}
function battleSeed(run, nodeId, missionId) {
    const seed = typeof run.seed === "string" ? `s:${run.seed.length}:${run.seed}` : `n:${String(run.seed)}`;
    return `towerforge:campaign-battle:v1|${seed}|n:${nodeId.length}:${nodeId}|m:${missionId.length}:${missionId}`;
}
function binaryCompare(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
function canonicalCampaignLaunchGraph(campaign) {
    return {
        ...campaign,
        entryNodeIds: [...campaign.entryNodeIds].sort(binaryCompare),
        nodes: campaign.nodes.map((node) => ({
            ...node,
            nextNodeIds: [...node.nextNodeIds].sort(binaryCompare),
            ...("choices" in node && Array.isArray(node.choices)
                ? { choices: [...node.choices].sort((left, right) => binaryCompare(left.id, right.id)) }
                : {})
        })).sort((left, right) => binaryCompare(left.id, right.id))
    };
}
function launchId(run, content, campaign, nodeId, missionId) {
    return stableDigest({
        schemaVersion: 1,
        domain: "campaign-battle-launch",
        contentDigest: getSimulationContentDigest(content),
        campaign: canonicalCampaignLaunchGraph(campaign),
        run,
        nodeId,
        missionId
    }).slice("tf-state-v1:".length);
}
function battleDraftChoiceCount(content, node) {
    if (!isBattleNode(node))
        return 0;
    const active = resolveActiveRogueliteMechanics(content, node.missionId);
    if (!active?.draft)
        return 0;
    return Math.max(0, (content.missions[node.missionId]?.waves.length ?? 0) - 1);
}
function maximumRemainingDraftChoices(content, nodes, nodeId, includeNode) {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const memo = new Map();
    const visit = (id) => {
        const cached = memo.get(id);
        if (cached !== undefined)
            return cached;
        const node = byId.get(id);
        if (!node)
            return 0;
        let successorMaximum = 0;
        for (const successorId of node.nextNodeIds) {
            successorMaximum = Math.max(successorMaximum, visit(successorId));
        }
        const result = battleDraftChoiceCount(content, node) + successorMaximum;
        memo.set(id, result);
        return result;
    };
    const node = byId.get(nodeId);
    if (!node)
        return 0;
    if (includeNode)
        return visit(nodeId);
    return node.nextNodeIds.reduce((maximum, successorId) => Math.max(maximum, visit(successorId)), 0);
}
function availableNodeIds(run, campaign) {
    const nodeIds = run.nodeId === null
        ? campaign.entryNodeIds
        : campaign.nodes.find((node) => node.id === run.nodeId)?.nextNodeIds ?? [];
    return Object.freeze([...nodeIds].sort(binaryCompare));
}
function prepareValidatedCampaignBattle(validation, content, nodeId, construct) {
    const captured = validation.run;
    const fail = (code) => Object.freeze({
        ok: false,
        code,
        run: captured
    });
    if (!availableNodeIds(captured, validation.campaign).includes(nodeId))
        return fail("node_not_available");
    const node = validation.campaign.nodes.find((candidate) => candidate.id === nodeId);
    if (!isBattleNode(node))
        return fail("node_type_not_implemented");
    const active = resolveActiveRogueliteMechanics(content, node.missionId);
    if (active?.schemaVersion !== 4 || active.campaign?.schemaVersion !== 2) {
        return fail("campaign_handoff_inactive");
    }
    const requiredDraftEntries = maximumRemainingDraftChoices(content, validation.campaign.nodes, nodeId, true);
    if (captured.deck.length
        + captured.artifacts.length
        + Object.keys(captured.runResources).length
        + requiredDraftEntries
        > CAMPAIGN_RUN_LIMITS.collectionEntries)
        return fail("run_capacity_exceeded");
    if (campaignBattleWorstCaseModifierCount(captured.deck, content, node.missionId) > MAX_MODIFIERS_PER_RESOLUTION) {
        return fail("modifier_budget_exceeded");
    }
    if (!preflightHeroAuraDamageFinite(content, node.missionId, { deck: captured.deck }).ok) {
        return fail("modifier_budget_exceeded");
    }
    const maxNewArtifactInstances = Math.min(CAMPAIGN_RUN_LIMITS.collectionEntries
        - captured.deck.length
        - captured.artifacts.length
        - Object.keys(captured.runResources).length
        - requiredDraftEntries, CAMPAIGN_RUN_LIMITS.collectionEntries - captured.artifacts.length);
    const id = launchId(captured, content, validation.campaign, nodeId, node.missionId);
    const seed = battleSeed(captured, nodeId, node.missionId);
    const loadout = Object.freeze({
        schemaVersion: 1,
        launchId: id,
        nodeId,
        maxNewArtifactInstances,
        deck: captured.deck,
        artifacts: captured.artifacts
    });
    const launch = Object.freeze({
        launchId: id,
        battleSeed: seed,
        missionId: node.missionId,
        loadout
    });
    const game = construct
        ? new TowerDefenseGame({ content, missionId: node.missionId, seed, campaignBattle: loadout })
        : undefined;
    if (!game)
        return fail("battle_context_mismatch");
    return Object.freeze({
        ok: true,
        code: "campaign_battle_prepared",
        nodeId,
        missionId: node.missionId,
        launchId: id,
        battleSeed: seed,
        run: captured,
        launch,
        game
    });
}
export function prepareCampaignBattle(run, content, nodeId) {
    const validation = validateCampaignRunAgainstContent(run, content);
    if (!validation.ok)
        return Object.freeze({ ok: false, code: validation.code, run: validation.run });
    return prepareValidatedCampaignBattle(validation, content, nodeId, true);
}
export function settleCampaignBattleVictory(run, profile, content, nodeId, earnedStars, game) {
    const validation = validateCampaignRunAgainstContent(run, content);
    const captured = validation.run;
    const fail = (code) => Object.freeze({
        ok: false,
        code,
        run: captured,
        profile
    });
    if (!validation.ok)
        return fail(validation.code);
    if (!availableNodeIds(captured, validation.campaign).includes(nodeId))
        return fail("node_not_available");
    const node = validation.campaign.nodes.find((candidate) => candidate.id === nodeId);
    if (!isBattleNode(node))
        return fail("node_type_not_implemented");
    const active = resolveActiveRogueliteMechanics(content, node.missionId);
    if (active?.schemaVersion !== 4 || active.campaign?.schemaVersion !== 2)
        return fail("campaign_handoff_inactive");
    const expectedLaunchId = launchId(captured, content, validation.campaign, nodeId, node.missionId);
    const binding = game.getCampaignBattleBinding();
    if (!binding
        || binding.launchId !== expectedLaunchId
        || binding.nodeId !== nodeId
        || binding.missionId !== node.missionId)
        return fail("battle_context_mismatch");
    const settlement = game.exportCampaignBattleSettlement();
    if (!settlement)
        return fail("battle_not_victorious");
    if (settlement.launchId !== expectedLaunchId
        || settlement.nodeId !== nodeId
        || settlement.missionId !== node.missionId
        || canonicalStringify(settlement.deck.slice(0, captured.deck.length)) !== canonicalStringify(captured.deck)
        || canonicalStringify(settlement.artifacts.slice(0, captured.artifacts.length)) !== canonicalStringify(captured.artifacts))
        return fail("battle_context_mismatch");
    let nextRun;
    try {
        nextRun = decodeCampaignRun({
            version: captured.version,
            seed: captured.seed,
            nodeId,
            deck: settlement.deck,
            artifacts: settlement.artifacts,
            runResources: captured.runResources
        }).run;
    }
    catch {
        return fail("run_capacity_exceeded");
    }
    const remainingDraftEntries = maximumRemainingDraftChoices(content, validation.campaign.nodes, nodeId, false);
    if (nextRun.deck.length
        + nextRun.artifacts.length
        + Object.keys(nextRun.runResources).length
        + remainingDraftEntries
        > CAMPAIGN_RUN_LIMITS.collectionEntries)
        return fail("run_capacity_exceeded");
    let profileResult;
    try {
        profileResult = recordPlayerMissionClear(profile, content, node.missionId, earnedStars);
    }
    catch {
        return fail("invalid_profile");
    }
    if (!profileResult.ok)
        return fail(profileResult.code);
    return Object.freeze({
        ok: true,
        code: "campaign_battle_settled",
        nodeId,
        run: nextRun,
        profile: profileResult.profile,
        newlyAvailableNodeIds: availableNodeIds(nextRun, validation.campaign)
    });
}
