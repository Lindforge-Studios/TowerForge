function cloneJson(value) {
    if (value === null || typeof value === "string" || typeof value === "boolean")
        return value;
    if (typeof value === "number") {
        if (!Number.isFinite(value))
            throw new Error("Auto-balancer patches require finite JSON numbers.");
        return value;
    }
    if (Array.isArray(value)) {
        if (Object.getPrototypeOf(value) !== Array.prototype)
            throw new Error("Auto-balancer patches require plain JSON arrays.");
        const descriptors = Object.getOwnPropertyDescriptors(value);
        if (Object.getOwnPropertySymbols(descriptors).length > 0) {
            throw new Error("Auto-balancer patches reject symbol fields.");
        }
        const keys = Object.keys(descriptors).filter((key) => key !== "length");
        if (keys.length !== value.length)
            throw new Error("Auto-balancer patches reject sparse or extended arrays.");
        const result = [];
        for (let index = 0; index < value.length; index += 1) {
            const descriptor = descriptors[String(index)];
            if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
                throw new Error("Auto-balancer patches require own JSON data.");
            }
            result.push(cloneJson(descriptor.value));
        }
        return Object.freeze(result);
    }
    if (typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype) {
        const result = {};
        const descriptors = Object.getOwnPropertyDescriptors(value);
        if (Object.getOwnPropertySymbols(descriptors).length > 0) {
            throw new Error("Auto-balancer patches reject symbol fields.");
        }
        for (const key of Object.keys(descriptors).sort()) {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor || !("value" in descriptor) || !descriptor.enumerable)
                throw new Error("Auto-balancer patches require own JSON data.");
            result[key] = cloneJson(descriptor.value);
        }
        return Object.freeze(result);
    }
    throw new Error("Auto-balancer patches require plain JSON data.");
}
function utf8Bytes(value) {
    return new TextEncoder().encode(value).length;
}
function normalizeDimensionStrings(value, label, limit) {
    if (!Array.isArray(value) || value.length < 1 || value.length > limit) {
        throw new Error(`Auto-balancer ${label} must contain 1..${limit} strings.`);
    }
    const normalized = value.map((entry) => {
        if (typeof entry !== "string" || entry.length === 0 || entry !== entry.trim()
            || /[\u0000-\u001f\u007f]/.test(entry)
            || utf8Bytes(entry) > AUTO_BALANCER_LIMITS.dimensionValueUtf8Bytes) {
            throw new Error(`Auto-balancer ${label} entries must be bounded non-empty strings without control characters.`);
        }
        return entry;
    });
    if (new Set(normalized).size !== normalized.length) {
        throw new Error(`Auto-balancer ${label} must be unique.`);
    }
    return Object.freeze(normalized.sort());
}
function normalizeCandidates(value) {
    if (!Array.isArray(value) || value.length < 1 || value.length > AUTO_BALANCER_LIMITS.candidates) {
        throw new Error(`Auto-balancer candidates must contain 1..${AUTO_BALANCER_LIMITS.candidates} entries.`);
    }
    const seen = new Set();
    const candidates = value.map((candidate) => {
        if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)
            || Object.getPrototypeOf(candidate) !== Object.prototype) {
            throw new Error("Auto-balancer candidates require a plain id/patch object.");
        }
        const descriptors = Object.getOwnPropertyDescriptors(candidate);
        if (Object.getOwnPropertySymbols(descriptors).length > 0) {
            throw new Error("Auto-balancer candidates reject symbol fields.");
        }
        if (Object.keys(descriptors).length !== 2 || !descriptors.id || !descriptors.patch
            || !("value" in descriptors.id) || !("value" in descriptors.patch)
            || !descriptors.id.enumerable || !descriptors.patch.enumerable) {
            throw new Error("Auto-balancer candidates require exactly enumerable id and patch data fields.");
        }
        const id = descriptors.id.value;
        if (typeof id !== "string" || !/^[A-Za-z0-9_-]+$/.test(id)
            || utf8Bytes(id) > AUTO_BALANCER_LIMITS.idUtf8Bytes) {
            throw new Error("Auto-balancer candidate id must be a bounded safe identifier.");
        }
        if (seen.has(id))
            throw new Error(`Duplicate auto-balancer candidate id "${id}".`);
        seen.add(id);
        const patch = cloneJson(descriptors.patch.value);
        if (patch === null || typeof patch !== "object" || Array.isArray(patch)) {
            throw new Error(`Auto-balancer candidate "${id}" patch must be a JSON object.`);
        }
        canonicalStringify(patch, { maxBytes: AUTO_BALANCER_LIMITS.patchBytes, maxNodes: 100_000 });
        return Object.freeze({ id, patch: patch });
    });
    return Object.freeze(candidates.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
export function runAutoBalancerBatch(request) {
    if (!Number.isFinite(request.baselineScore))
        throw new Error("Auto-balancer baselineScore must be finite.");
    const candidates = normalizeCandidates(request.candidates);
    const seeds = normalizeDimensionStrings(request.seeds, "seeds", AUTO_BALANCER_LIMITS.seeds);
    const strategyIds = normalizeDimensionStrings(request.strategyIds, "strategyIds", AUTO_BALANCER_LIMITS.strategies);
    if (candidates.length * seeds.length * strategyIds.length > AUTO_BALANCER_LIMITS.totalCandidateRuns) {
        throw new Error(`Auto-balancer candidate matrix exceeds ${AUTO_BALANCER_LIMITS.totalCandidateRuns} runs.`);
    }
    let evaluatedRuns = 0;
    const evaluated = [];
    for (const candidate of candidates) {
        let sum = 0;
        let count = 0;
        for (const seed of seeds) {
            for (const strategyId of strategyIds) {
                if (request.isCancelled?.()) {
                    return Object.freeze({ schemaVersion: 1, status: "cancelled", evaluatedRuns, proposals: Object.freeze([]) });
                }
                const score = request.evaluate({ candidateId: candidate.id, seed, strategyId });
                if (!Number.isFinite(score))
                    throw new Error(`Auto-balancer candidate "${candidate.id}" produced a non-finite score.`);
                sum += score;
                count += 1;
                evaluatedRuns += 1;
            }
        }
        evaluated.push({ candidate, sum, count });
    }
    if (request.isCancelled?.()) {
        return Object.freeze({ schemaVersion: 1, status: "cancelled", evaluatedRuns, proposals: Object.freeze([]) });
    }
    const ranked = evaluated.map(({ candidate, sum, count }) => {
        const candidateScore = sum / count;
        return {
            id: candidate.id,
            patch: cloneJson(candidate.patch),
            improvement: request.baselineScore - candidateScore,
            evidence: { runCount: count, baselineScore: request.baselineScore, candidateScore }
        };
    }).sort((a, b) => b.improvement - a.improvement || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const proposals = Object.freeze(ranked.map((entry, index) => Object.freeze({
        id: entry.id,
        rank: index + 1,
        patch: entry.patch,
        evidence: Object.freeze({
            ...entry.evidence,
            improvement: entry.improvement,
            seeds: Object.freeze([...seeds]),
            strategyIds: Object.freeze([...strategyIds])
        })
    })));
    return Object.freeze({ schemaVersion: 1, status: "completed", evaluatedRuns, proposals });
}
import { canonicalStringify } from "./stable-digest.js";
export const AUTO_BALANCER_LIMITS = Object.freeze({
    candidates: 32,
    seeds: 64,
    strategies: 32,
    totalCandidateRuns: 4096,
    idUtf8Bytes: 128,
    dimensionValueUtf8Bytes: 256,
    patchBytes: 4 * 1024 * 1024
});
