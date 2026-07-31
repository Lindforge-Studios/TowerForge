// Procedural Juice v1 is a presentation-only, deterministic projection over engine events.
// It deliberately owns no simulation state and never reads the clock or Math.random.

export const PROCEDURAL_JUICE_PRESENTATION_LIMITS = Object.freeze({
  eventsPerFrame: 64,
  particleEmitters: 64,
  audioCues: 64,
  cameraCues: 64,
  eventBindings: 128,
  referencesPerBinding: 16,
  particlesPerEmitter: 256,
  authoredParticles: 4_096,
  projectedInstructions: 2_048
});

export const INACTIVE_PROCEDURAL_JUICE_PRESENTATION = Object.freeze({
  active: false,
  particleBursts: Object.freeze([]),
  audioCues: Object.freeze([]),
  cameraCues: Object.freeze([])
});

export const PROCEDURAL_JUICE_PRESENTATION_EVENTS = Object.freeze([
  "towerPlaced", "towerUpgraded", "towerFired", "enemyHit", "enemyKilled", "enemyLeaked",
  "areaPulse", "waveStarted", "waveCleared", "victory", "defeat", "enemyShieldChanged",
  "towerShieldChanged", "enemyMarkChanged", "enemyExposureChanged", "enemyReactionTriggered",
  "enemyDisplacementResolved", "enemyFell", "heroAbilityUsed", "objectiveCompleted", "objectiveFailed",
  "destructibleObjectDamaged", "destructibleObjectDestroyed"
]);
const PROCEDURAL_JUICE_EVENT_SET = new Set(PROCEDURAL_JUICE_PRESENTATION_EVENTS);

const INVALID = Symbol("invalid");

function binaryCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function ownData(record, key) {
  if (record === null || typeof record !== "object") return INVALID;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor) return undefined;
    return descriptor.enumerable === true && "value" in descriptor ? descriptor.value : INVALID;
  } catch {
    return INVALID;
  }
}

function recordEntries(value, max, exactKeys) {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    if (Object.getOwnPropertySymbols(value).length > 0) return undefined;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(descriptors);
    if (keys.length > max) return undefined;
    if (exactKeys) {
      const allowed = new Set(exactKeys);
      if (keys.some((key) => !allowed.has(key))) return undefined;
    }
    const entries = [];
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) return undefined;
      entries.push([key, descriptor.value]);
    }
    return entries;
  } catch {
    return undefined;
  }
}

function denseArray(value, max) {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
      || Object.getOwnPropertySymbols(value).length > 0) return undefined;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const length = descriptors.length && "value" in descriptors.length ? descriptors.length.value : -1;
    if (!Number.isSafeInteger(length) || length < 0 || length > max) return undefined;
    const result = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) return undefined;
      result.push(descriptor.value);
    }
    if (Object.keys(descriptors).some((key) => key !== "length" && !/^(0|[1-9][0-9]*)$/.test(key))) return undefined;
    return result;
  } catch {
    return undefined;
  }
}

function stringList(value, max) {
  if (value === undefined) return Object.freeze([]);
  const values = denseArray(value, max);
  if (!values || values.some((entry) => typeof entry !== "string" || !/^[a-z][a-z0-9_-]{0,63}$/i.test(entry))) return undefined;
  if (new Set(values).size !== values.length) return undefined;
  return Object.freeze([...values].sort(binaryCompare));
}

function contentIdList(value, max) {
  if (value === undefined) return Object.freeze([]);
  const values = denseArray(value, max);
  if (!values || values.some((entry) => typeof entry !== "string" || entry.length === 0)) return undefined;
  if (new Set(values).size !== values.length) return undefined;
  return Object.freeze([...values].sort(binaryCompare));
}

function finiteRange(value, min, max) {
  return Number.isFinite(value) && value >= min && value <= max;
}

function identifier(value) {
  return typeof value === "string" && /^[a-z][a-z0-9_-]{0,63}$/i.test(value);
}

function minMax(value, min, max) {
  const entries = recordEntries(value, 2, ["min", "max"]);
  if (!entries || entries.length !== 2) return undefined;
  const low = ownData(value, "min");
  const high = ownData(value, "max");
  if (!finiteRange(low, min, max) || !finiteRange(high, min, max) || low > high) return undefined;
  return Object.freeze({ min: low, max: high });
}

function compileEmitter(id, value) {
  const entries = recordEntries(value, 8, [
    "maxParticles", "lifetimeMs", "speedPxPerSecond", "angleDegrees", "sizePx", "color",
    "gravityPxPerSecondSquared", "blendMode"
  ]);
  if (!entries) return undefined;
  const maxParticles = ownData(value, "maxParticles");
  const lifetimeMs = minMax(ownData(value, "lifetimeMs"), 1, 10_000);
  const speedPxPerSecond = minMax(ownData(value, "speedPxPerSecond"), 0, 4_096);
  const angleDegrees = minMax(ownData(value, "angleDegrees"), -3_600, 3_600);
  const sizePx = minMax(ownData(value, "sizePx"), 0.1, 256);
  const color = ownData(value, "color");
  const gravity = ownData(value, "gravityPxPerSecondSquared");
  const blendMode = ownData(value, "blendMode") ?? "normal";
  if (!identifier(id)
    || !Number.isInteger(maxParticles) || maxParticles < 1 || maxParticles > PROCEDURAL_JUICE_PRESENTATION_LIMITS.particlesPerEmitter
    || !lifetimeMs || !speedPxPerSecond || !angleDegrees || !sizePx
    || !/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(color)
    || (gravity !== undefined && !finiteRange(gravity, -4_096, 4_096))
    || !["normal", "additive", "multiply"].includes(blendMode)) return undefined;
  return Object.freeze({
    id, maxParticles, lifetimeMs, speedPxPerSecond, angleDegrees, sizePx, color,
    gravityPxPerSecondSquared: gravity ?? 0, blendMode
  });
}

function compileAudioCue(id, value) {
  const entries = recordEntries(value, 5, ["waveform", "baseFrequencyHz", "durationMs", "gain", "pitchSemitones"]);
  if (!entries) return undefined;
  const waveform = ownData(value, "waveform");
  const baseFrequencyHz = ownData(value, "baseFrequencyHz");
  const durationMs = ownData(value, "durationMs");
  const gain = ownData(value, "gain");
  if (!identifier(id) || !["sine", "triangle", "square", "sawtooth", "noise"].includes(waveform)
    || !finiteRange(baseFrequencyHz, 20, 20_000) || !finiteRange(durationMs, 1, 10_000)
    || !finiteRange(gain, 0, 1)) return undefined;
  const pitchValue = ownData(value, "pitchSemitones");
  let pitchSemitones = Object.freeze({ damage: 0, attackSpeed: 0, targetSize: 0, variation: Object.freeze({ min: 0, max: 0 }) });
  if (pitchValue !== undefined) {
    const pitchEntries = recordEntries(pitchValue, 4, ["damage", "attackSpeed", "targetSize", "variation"]);
    if (!pitchEntries) return undefined;
    const damage = ownData(pitchValue, "damage") ?? 0;
    const attackSpeed = ownData(pitchValue, "attackSpeed") ?? 0;
    const targetSize = ownData(pitchValue, "targetSize") ?? 0;
    const variationValue = ownData(pitchValue, "variation");
    const variation = variationValue === undefined ? Object.freeze({ min: 0, max: 0 }) : minMax(variationValue, -24, 24);
    if (![damage, attackSpeed, targetSize].every((item) => finiteRange(item, -48, 48)) || !variation) return undefined;
    pitchSemitones = Object.freeze({ damage, attackSpeed, targetSize, variation });
  }
  return Object.freeze({ id, waveform, baseFrequencyHz, durationMs, gain, pitchSemitones });
}

function compileCameraCue(id, value) {
  const entries = recordEntries(value, 3, ["shake", "hitStop", "chromaticAberration"]);
  if (!entries) return undefined;
  const parseTimedIntensity = (raw, maxDuration) => {
    const shape = recordEntries(raw, 2, ["durationMs", "intensity"]);
    if (!shape) return undefined;
    const durationMs = ownData(raw, "durationMs");
    const intensity = ownData(raw, "intensity");
    return finiteRange(durationMs, 1, maxDuration) && finiteRange(intensity, 0, 1)
      ? Object.freeze({ durationMs, intensity }) : undefined;
  };
  const shakeRaw = ownData(value, "shake");
  const chromaticRaw = ownData(value, "chromaticAberration");
  const hitStopRaw = ownData(value, "hitStop");
  const shake = shakeRaw === undefined ? undefined : parseTimedIntensity(shakeRaw, 10_000);
  const chromaticAberration = chromaticRaw === undefined ? undefined : parseTimedIntensity(chromaticRaw, 10_000);
  let hitStop;
  if (hitStopRaw !== undefined) {
    const shape = recordEntries(hitStopRaw, 2, ["durationMs", "timeScale"]);
    const durationMs = ownData(hitStopRaw, "durationMs");
    const timeScale = ownData(hitStopRaw, "timeScale");
    if (!shape || !finiteRange(durationMs, 1, 1_000) || !finiteRange(timeScale, Number.MIN_VALUE, 1)) return undefined;
    hitStop = Object.freeze({ durationMs, timeScale });
  }
  if (!identifier(id) || (shakeRaw !== undefined && !shake) || (chromaticRaw !== undefined && !chromaticAberration)
    || (hitStopRaw !== undefined && !hitStop) || (!shake && !chromaticAberration && !hitStop)) return undefined;
  return Object.freeze({ id, ...(shake ? { shake } : {}), ...(hitStop ? { hitStop } : {}), ...(chromaticAberration ? { chromaticAberration } : {}) });
}

function compileBinding(id, value, catalogs) {
  const entries = recordEntries(value, 6, ["event", "missionIds", "enemyTypeIds", "particleEmitterIds", "audioCueIds", "cameraCueIds"]);
  if (!entries) return undefined;
  const event = ownData(value, "event");
  if (typeof event !== "string" || !PROCEDURAL_JUICE_EVENT_SET.has(event)) return undefined;
  const missionIds = contentIdList(ownData(value, "missionIds"), 64);
  const enemyTypeIds = contentIdList(ownData(value, "enemyTypeIds"), 64);
  const particleEmitterIds = stringList(ownData(value, "particleEmitterIds"), PROCEDURAL_JUICE_PRESENTATION_LIMITS.referencesPerBinding);
  const audioCueIds = stringList(ownData(value, "audioCueIds"), PROCEDURAL_JUICE_PRESENTATION_LIMITS.referencesPerBinding);
  const cameraCueIds = stringList(ownData(value, "cameraCueIds"), PROCEDURAL_JUICE_PRESENTATION_LIMITS.referencesPerBinding);
  if (!identifier(id) || !missionIds || !enemyTypeIds || !particleEmitterIds || !audioCueIds || !cameraCueIds
    || particleEmitterIds.length + audioCueIds.length + cameraCueIds.length === 0
    || particleEmitterIds.some((entry) => !catalogs.emitters.has(entry))
    || audioCueIds.some((entry) => !catalogs.audio.has(entry))
    || cameraCueIds.some((entry) => !catalogs.camera.has(entry))) return undefined;
  return Object.freeze({ id, event, missionIds, enemyTypeIds, particleEmitterIds, audioCueIds, cameraCueIds });
}

function compileCatalog(visuals) {
  if (ownData(visuals, "schemaVersion") !== 3) return undefined;
  const juice = ownData(visuals, "proceduralJuice");
  if (juice === INVALID || !recordEntries(juice, 5, ["schemaVersion", "particleEmitters", "audioCues", "cameraCues", "eventBindings"])
    || ownData(juice, "schemaVersion") !== 1) return undefined;
  const emitterEntries = recordEntries(ownData(juice, "particleEmitters"), PROCEDURAL_JUICE_PRESENTATION_LIMITS.particleEmitters);
  const audioEntries = recordEntries(ownData(juice, "audioCues"), PROCEDURAL_JUICE_PRESENTATION_LIMITS.audioCues);
  const cameraEntries = recordEntries(ownData(juice, "cameraCues"), PROCEDURAL_JUICE_PRESENTATION_LIMITS.cameraCues);
  const bindingEntries = recordEntries(ownData(juice, "eventBindings"), PROCEDURAL_JUICE_PRESENTATION_LIMITS.eventBindings);
  if (!emitterEntries || !audioEntries || !cameraEntries || !bindingEntries) return undefined;
  const emitters = new Map();
  const audio = new Map();
  const camera = new Map();
  let authoredParticles = 0;
  for (const [id, raw] of emitterEntries) {
    const item = compileEmitter(id, raw);
    if (!item) return undefined;
    authoredParticles += item.maxParticles;
    if (authoredParticles > PROCEDURAL_JUICE_PRESENTATION_LIMITS.authoredParticles) return undefined;
    emitters.set(id, item);
  }
  for (const [id, raw] of audioEntries) { const item = compileAudioCue(id, raw); if (!item) return undefined; audio.set(id, item); }
  for (const [id, raw] of cameraEntries) { const item = compileCameraCue(id, raw); if (!item) return undefined; camera.set(id, item); }
  const bindings = [];
  for (const [id, raw] of bindingEntries) { const item = compileBinding(id, raw, { emitters, audio, camera }); if (!item) return undefined; bindings.push(item); }
  bindings.sort((left, right) => binaryCompare(left.id, right.id));
  const sortedCatalog = (catalog) => [...catalog.values()]
    .sort((left, right) => binaryCompare(left.id, right.id));
  const digest = fnv64(JSON.stringify([
    "tf-juice-catalog-v1",
    sortedCatalog(emitters),
    sortedCatalog(audio),
    sortedCatalog(camera),
    bindings
  ]));
  return Object.freeze({ emitters, audio, camera, bindings: Object.freeze(bindings), digest });
}

function coordinate(raw) {
  if (recordEntries(raw, 2, ["q", "r"]) === undefined) return undefined;
  const q = ownData(raw, "q");
  const r = ownData(raw, "r");
  return Number.isSafeInteger(q) && Number.isSafeInteger(r) ? Object.freeze({ q, r }) : undefined;
}

function entityOrigin(snapshot, previousSnapshot, event) {
  const direct = coordinate(ownData(event, "originCoord")) || coordinate(ownData(event, "sourceCoord")) || coordinate(ownData(event, "coord"));
  if (direct) return direct;
  const enemyId = ownData(event, "enemyId") ?? ownData(event, "originEnemyId") ?? ownData(event, "targetEnemyId");
  if (typeof enemyId === "string") {
    for (const source of [snapshot, previousSnapshot]) {
      const enemies = denseArray(ownData(source, "enemies"), 4_096);
      if (!enemies) continue;
      for (const enemy of enemies) {
        if (ownData(enemy, "id") !== enemyId) continue;
        const navigation = ownData(enemy, "navigation");
        const current = coordinate(ownData(navigation, "currentCoord"));
        if (current) return current;
      }
    }
  }
  const towerId = ownData(event, "towerId");
  if (typeof towerId === "string") {
    for (const source of [snapshot, previousSnapshot]) {
      const towers = denseArray(ownData(source, "towers"), 4_096);
      if (!towers) continue;
      for (const tower of towers) if (ownData(tower, "id") === towerId) {
        const point = coordinate(ownData(tower, "coord"));
        if (point) return point;
      }
    }
  }
  const heroId = ownData(event, "heroId");
  if (typeof heroId === "string") {
    for (const source of [snapshot, previousSnapshot]) {
      const heroes = ownData(source, "heroes");
      const units = denseArray(ownData(heroes, "units"), 16);
      if (!units) continue;
      for (const hero of units) if (ownData(hero, "id") === heroId) {
        const point = coordinate(ownData(hero, "coord"));
        if (point) return point;
      }
    }
  }
  return coordinate(ownData(snapshot, "coreCoord")) || coordinate(ownData(snapshot, "spawnCoord"));
}

function canonicalScalarEvent(event) {
  const entries = recordEntries(event, 64);
  if (!entries) return undefined;
  const projected = {};
  for (const [key, value] of entries.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) {
    if (typeof value === "string" || typeof value === "boolean" || value === null || Number.isFinite(value)) projected[key] = value;
  }
  return JSON.stringify(projected);
}

function fnv64(text) {
  let hash = 0xcbf29ce484222325n;
  const bytes = new TextEncoder().encode(text);
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

function unitFromSeed(seed) {
  return Number(BigInt(`0x${seed}`) & 0xffffffffn) / 0xffffffff;
}

function attackSpeedFor(event, snapshot, content) {
  const towerId = ownData(event, "towerId");
  const towers = denseArray(ownData(snapshot, "towers"), 4_096);
  const tower = towers?.find((entry) => ownData(entry, "id") === towerId);
  const typeId = ownData(tower, "typeId");
  const towerType = typeId && ownData(ownData(content, "towers"), typeId);
  const attack = ownData(towerType, "attack");
  const fireRate = ownData(attack, "fireRate");
  if (Number.isFinite(fireRate) && fireRate >= 0) return fireRate;
  const interval = ownData(attack, "interval");
  return Number.isFinite(interval) && interval > 0 ? 1 / interval : 0;
}

function targetSizeFor(event, snapshot, previousSnapshot, content) {
  const enemyId = ownData(event, "enemyId") ?? ownData(event, "originEnemyId") ?? ownData(event, "targetEnemyId");
  for (const source of [snapshot, previousSnapshot]) {
    const enemies = denseArray(ownData(source, "enemies"), 4_096);
    const enemy = enemies?.find((entry) => ownData(entry, "id") === enemyId);
    const maxHp = ownData(enemy, "maxHp");
    if (Number.isFinite(maxHp) && maxHp > 0) return Math.log2(maxHp + 1);
  }
  const enemyTypeId = ownData(event, "enemyTypeId") ?? ownData(event, "targetEnemyTypeId");
  const type = enemyTypeId && ownData(ownData(content, "enemies"), enemyTypeId);
  const maxHp = ownData(type, "maxHp");
  return Number.isFinite(maxHp) && maxHp > 0 ? Math.log2(maxHp + 1) : 0;
}

function audioInstruction(bindingId, cue, seed, event, snapshot, previousSnapshot, content, origin) {
  const eventType = ownData(event, "type");
  const damage = ownData(event, "damage");
  const variation = cue.pitchSemitones.variation;
  const variationValue = variation.min + (variation.max - variation.min) * unitFromSeed(seed);
  const semitones = Math.max(-96, Math.min(96,
    (Number.isFinite(damage) ? damage : 0) * cue.pitchSemitones.damage
      + attackSpeedFor(event, snapshot, content) * cue.pitchSemitones.attackSpeed
      + targetSizeFor(event, snapshot, previousSnapshot, content) * cue.pitchSemitones.targetSize
      + variationValue
  ));
  const frequencyHz = Math.max(20, Math.min(20_000, cue.baseFrequencyHz * (2 ** (semitones / 12))));
  return Object.freeze({ bindingId, cueId: cue.id, eventType, seed, origin, waveform: cue.waveform, frequencyHz, durationMs: cue.durationMs, gain: cue.gain });
}

/**
 * Convert a supported visuals v3 catalog plus one authoritative render snapshot into detached,
 * deterministic presentation instructions. Any malformed/future/hostile input returns the one
 * frozen inactive sentinel; a valid but filtered catalog returns active empty arrays.
 */
export function projectProceduralJuicePresentation(options) {
  const visuals = ownData(options, "visuals");
  const snapshot = ownData(options, "snapshot");
  if (ownData(visuals, "schemaVersion") !== 3 || ownData(visuals, "proceduralJuice") === undefined) {
    return INACTIVE_PROCEDURAL_JUICE_PRESENTATION;
  }
  const catalog = compileCatalog(visuals);
  if (!catalog || snapshot === INVALID || snapshot === undefined) return INACTIVE_PROCEDURAL_JUICE_PRESENTATION;
  const previousSnapshotValue = ownData(options, "previousSnapshot");
  const previousSnapshot = previousSnapshotValue === INVALID || previousSnapshotValue === undefined ? snapshot : previousSnapshotValue;
  const contentValue = ownData(options, "content");
  const content = contentValue === INVALID || contentValue === undefined ? {} : contentValue;
  const events = denseArray(ownData(snapshot, "lastEvents"), PROCEDURAL_JUICE_PRESENTATION_LIMITS.eventsPerFrame);
  const missionId = ownData(snapshot, "missionId");
  const missionElapsed = ownData(snapshot, "missionElapsed");
  if (!events || typeof missionId !== "string" || !Number.isFinite(missionElapsed)) return INACTIVE_PROCEDURAL_JUICE_PRESENTATION;
  const particleBursts = [];
  const audioCues = [];
  const cameraCues = [];
  let instructionCount = 0;
  eventLoop: for (let eventIndex = 0; eventIndex < events.length; eventIndex += 1) {
    const event = events[eventIndex];
    const eventType = ownData(event, "type");
    const eventData = canonicalScalarEvent(event);
    if (typeof eventType !== "string" || eventData === undefined) return INACTIVE_PROCEDURAL_JUICE_PRESENTATION;
    for (const binding of catalog.bindings) {
      if (binding.event !== eventType || (binding.missionIds.length > 0 && !binding.missionIds.includes(missionId))) continue;
      const enemyTypeId = ownData(event, "enemyTypeId") ?? ownData(event, "originEnemyTypeId") ?? ownData(event, "targetEnemyTypeId");
      if (binding.enemyTypeIds.length > 0 && !binding.enemyTypeIds.includes(enemyTypeId)) continue;
      const origin = entityOrigin(snapshot, previousSnapshot, event);
      if (!origin) continue;
      const base = JSON.stringify([
        "tf-juice-rng-v1", catalog.digest, missionId, missionElapsed, eventIndex, binding.id, eventData
      ]);
      for (const emitterId of binding.particleEmitterIds) {
        const emitter = catalog.emitters.get(emitterId);
        const remaining = PROCEDURAL_JUICE_PRESENTATION_LIMITS.projectedInstructions - instructionCount;
        if (remaining <= 0) break eventLoop;
        const count = Math.min(emitter.maxParticles, remaining);
        const seed = fnv64(`${base}|particle|${emitterId}`);
        particleBursts.push(Object.freeze({
          bindingId: binding.id, emitterId, seed, origin, count,
          lifetimeMs: emitter.lifetimeMs, speedPxPerSecond: emitter.speedPxPerSecond,
          angleDegrees: emitter.angleDegrees, sizePx: emitter.sizePx, color: emitter.color,
          gravityPxPerSecondSquared: emitter.gravityPxPerSecondSquared, blendMode: emitter.blendMode
        }));
        instructionCount += count;
        if (count < emitter.maxParticles || instructionCount >= PROCEDURAL_JUICE_PRESENTATION_LIMITS.projectedInstructions) break eventLoop;
      }
      for (const cueId of binding.audioCueIds) {
        if (instructionCount >= PROCEDURAL_JUICE_PRESENTATION_LIMITS.projectedInstructions) break eventLoop;
        const cue = catalog.audio.get(cueId);
        const seed = fnv64(`${base}|audio|${cueId}`);
        audioCues.push(audioInstruction(binding.id, cue, seed, event, snapshot, previousSnapshot, content, origin));
        instructionCount += 1;
      }
      for (const cueId of binding.cameraCueIds) {
        if (instructionCount >= PROCEDURAL_JUICE_PRESENTATION_LIMITS.projectedInstructions) break eventLoop;
        const cue = catalog.camera.get(cueId);
        const seed = fnv64(`${base}|camera|${cueId}`);
        cameraCues.push(Object.freeze({ bindingId: binding.id, cueId, seed, origin, ...(cue.shake ? { shake: cue.shake } : {}), ...(cue.hitStop ? { hitStop: cue.hitStop } : {}), ...(cue.chromaticAberration ? { chromaticAberration: cue.chromaticAberration } : {}) }));
        instructionCount += 1;
      }
    }
  }
  return Object.freeze({
    active: true,
    particleBursts: Object.freeze(particleBursts),
    audioCues: Object.freeze(audioCues),
    cameraCues: Object.freeze(cameraCues)
  });
}
