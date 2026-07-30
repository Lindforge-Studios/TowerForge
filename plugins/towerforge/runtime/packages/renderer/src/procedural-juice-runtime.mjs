import { PROCEDURAL_JUICE_PRESENTATION_LIMITS } from "./procedural-juice-presentation.mjs";

// This state belongs exclusively to a renderer/player. None of its clocks or values may feed
// commands, simulation deltas, checkpoints, journals, or state digests.
export const PROCEDURAL_JUICE_RUNTIME_LIMITS = Object.freeze({
  liveParticles: 2_048,
  audioVoicesPerFrame: 32,
  queuedAudioVoices: 128,
  activeCameraCues: 128,
  rememberedFrames: 256,
  bufferedWorldSnapshots: 128,
  reducedParticleDensity: 0.25,
  reducedShakeMagnitude: 0.25
});

const EMPTY_INGEST_RESULT = Object.freeze({ particles: 0, audioCues: 0, cameraCues: 0 });
const MASK_64 = (1n << 64n) - 1n;
const UINT_53_RANGE = 9_007_199_254_740_992;

function ownData(record, key) {
  if (record === null || typeof record !== "object") return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    return descriptor?.enumerable === true && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function closedRecord(value, allowedKeys) {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    if (Object.getOwnPropertySymbols(value).length > 0) return false;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const allowed = new Set(allowedKeys);
    return Object.keys(descriptors).every((key) => {
      const descriptor = descriptors[key];
      return allowed.has(key) && descriptor?.enumerable === true && "value" in descriptor;
    });
  } catch {
    return false;
  }
}

function denseArray(value, maximum) {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return undefined;
    if (Object.getOwnPropertySymbols(value).length > 0) return undefined;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const length = descriptors.length && "value" in descriptors.length ? descriptors.length.value : -1;
    if (!Number.isSafeInteger(length) || length < 0 || length > maximum) return undefined;
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

function finite(value, minimum, maximum) {
  return Number.isFinite(value) && value >= minimum && value <= maximum;
}

function identifier(value) {
  return typeof value === "string" && /^[a-z][a-z0-9_-]{0,63}$/i.test(value);
}

function seed64(value) {
  return typeof value === "string" && /^[0-9a-f]{16}$/i.test(value);
}

function coordinate(value) {
  if (!closedRecord(value, ["q", "r"])) return undefined;
  const q = ownData(value, "q");
  const r = ownData(value, "r");
  return Number.isSafeInteger(q) && Number.isSafeInteger(r) ? Object.freeze({ q, r }) : undefined;
}

function range(value, minimum, maximum) {
  if (!closedRecord(value, ["min", "max"])) return undefined;
  const min = ownData(value, "min");
  const max = ownData(value, "max");
  return finite(min, minimum, maximum) && finite(max, minimum, maximum) && min <= max
    ? Object.freeze({ min, max })
    : undefined;
}

function compileParticleBurst(raw) {
  if (!closedRecord(raw, [
    "bindingId", "emitterId", "seed", "origin", "count", "lifetimeMs", "speedPxPerSecond",
    "angleDegrees", "sizePx", "color", "gravityPxPerSecondSquared", "blendMode"
  ])) return undefined;
  const bindingId = ownData(raw, "bindingId");
  const emitterId = ownData(raw, "emitterId");
  const seed = ownData(raw, "seed");
  const origin = coordinate(ownData(raw, "origin"));
  const count = ownData(raw, "count");
  const lifetimeMs = range(ownData(raw, "lifetimeMs"), 1, 10_000);
  const speedPxPerSecond = range(ownData(raw, "speedPxPerSecond"), 0, 4_096);
  const angleDegrees = range(ownData(raw, "angleDegrees"), -3_600, 3_600);
  const sizePx = range(ownData(raw, "sizePx"), 0.1, 256);
  const color = ownData(raw, "color");
  const gravity = ownData(raw, "gravityPxPerSecondSquared");
  const blendMode = ownData(raw, "blendMode");
  if (!identifier(bindingId) || !identifier(emitterId) || !seed64(seed) || !origin
    || !Number.isInteger(count) || count < 1 || count > PROCEDURAL_JUICE_PRESENTATION_LIMITS.particlesPerEmitter
    || !lifetimeMs || !speedPxPerSecond || !angleDegrees || !sizePx
    || typeof color !== "string" || !/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(color)
    || !finite(gravity, -4_096, 4_096) || !["normal", "additive", "multiply"].includes(blendMode)) return undefined;
  return Object.freeze({
    bindingId, emitterId, seed: seed.toLowerCase(), origin, count, lifetimeMs, speedPxPerSecond,
    angleDegrees, sizePx, color, gravityPxPerSecondSquared: gravity, blendMode
  });
}

function compileAudioCue(raw) {
  if (!closedRecord(raw, [
    "bindingId", "cueId", "eventType", "seed", "origin", "waveform", "frequencyHz", "durationMs", "gain"
  ])) return undefined;
  const bindingId = ownData(raw, "bindingId");
  const cueId = ownData(raw, "cueId");
  const eventType = ownData(raw, "eventType");
  const seed = ownData(raw, "seed");
  const origin = coordinate(ownData(raw, "origin"));
  const waveform = ownData(raw, "waveform");
  const frequencyHz = ownData(raw, "frequencyHz");
  const durationMs = ownData(raw, "durationMs");
  const gain = ownData(raw, "gain");
  if (!identifier(bindingId) || !identifier(cueId) || !identifier(eventType) || !seed64(seed) || !origin
    || !["sine", "triangle", "square", "sawtooth", "noise"].includes(waveform)
    || !finite(frequencyHz, 20, 20_000) || !finite(durationMs, 1, 10_000) || !finite(gain, 0, 1)) return undefined;
  return Object.freeze({
    bindingId, cueId, eventType, seed: seed.toLowerCase(), origin, waveform, frequencyHz, durationMs, gain
  });
}

function timedIntensity(raw) {
  if (!closedRecord(raw, ["durationMs", "intensity"])) return undefined;
  const durationMs = ownData(raw, "durationMs");
  const intensity = ownData(raw, "intensity");
  return finite(durationMs, 1, 10_000) && finite(intensity, 0, 1)
    ? Object.freeze({ durationMs, intensity })
    : undefined;
}

function compileCameraCue(raw) {
  if (!closedRecord(raw, ["bindingId", "cueId", "seed", "origin", "shake", "hitStop", "chromaticAberration"])) return undefined;
  const bindingId = ownData(raw, "bindingId");
  const cueId = ownData(raw, "cueId");
  const seed = ownData(raw, "seed");
  const origin = coordinate(ownData(raw, "origin"));
  const shakeValue = ownData(raw, "shake");
  const hitStopValue = ownData(raw, "hitStop");
  const chromaticValue = ownData(raw, "chromaticAberration");
  const shake = shakeValue === undefined ? undefined : timedIntensity(shakeValue);
  const chromaticAberration = chromaticValue === undefined ? undefined : timedIntensity(chromaticValue);
  let hitStop;
  if (hitStopValue !== undefined) {
    if (!closedRecord(hitStopValue, ["durationMs", "timeScale"])) return undefined;
    const durationMs = ownData(hitStopValue, "durationMs");
    const timeScale = ownData(hitStopValue, "timeScale");
    if (!finite(durationMs, 1, 1_000) || !finite(timeScale, Number.MIN_VALUE, 1)) return undefined;
    hitStop = Object.freeze({ durationMs, timeScale });
  }
  if (!identifier(bindingId) || !identifier(cueId) || !seed64(seed) || !origin
    || (shakeValue !== undefined && !shake) || (chromaticValue !== undefined && !chromaticAberration)
    || (!shake && !hitStop && !chromaticAberration)) return undefined;
  return Object.freeze({
    bindingId, cueId, seed: seed.toLowerCase(), origin,
    ...(shake ? { shake } : {}),
    ...(hitStop ? { hitStop } : {}),
    ...(chromaticAberration ? { chromaticAberration } : {})
  });
}

function compileProjection(value) {
  if (!closedRecord(value, ["active", "particleBursts", "audioCues", "cameraCues"]) || ownData(value, "active") !== true) return undefined;
  const particleRaw = denseArray(ownData(value, "particleBursts"), PROCEDURAL_JUICE_PRESENTATION_LIMITS.projectedInstructions);
  const audioRaw = denseArray(ownData(value, "audioCues"), PROCEDURAL_JUICE_PRESENTATION_LIMITS.projectedInstructions);
  const cameraRaw = denseArray(ownData(value, "cameraCues"), PROCEDURAL_JUICE_PRESENTATION_LIMITS.projectedInstructions);
  if (!particleRaw || !audioRaw || !cameraRaw) return undefined;
  const particleBursts = particleRaw.map(compileParticleBurst);
  const audioCues = audioRaw.map(compileAudioCue);
  const cameraCues = cameraRaw.map(compileCameraCue);
  if (particleBursts.some((item) => !item) || audioCues.some((item) => !item) || cameraCues.some((item) => !item)) return undefined;
  return { particleBursts, audioCues, cameraCues };
}

function projectionFrameKey(projection) {
  const identities = [
    ...projection.particleBursts.map((item) => `p:${item.bindingId}:${item.emitterId}:${item.seed}`),
    ...projection.audioCues.map((item) => `a:${item.bindingId}:${item.cueId}:${item.seed}`),
    ...projection.cameraCues.map((item) => `c:${item.bindingId}:${item.cueId}:${item.seed}`)
  ];
  return identities.length > 0 ? fnv64(identities.join("|")) : undefined;
}

function canonicalFrameKey(value) {
  if (typeof value === "string" && value.length > 0 && value.length <= 256) return `s:${value}`;
  if (Number.isSafeInteger(value)) return `n:${value}`;
  return undefined;
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

function seededUnit(seed, particleIndex, lane) {
  let value = (BigInt(`0x${seed}`) + BigInt(particleIndex + 1) * 0x9e3779b97f4a7c15n
    + BigInt(lane + 1) * 0xbf58476d1ce4e5b9n) & MASK_64;
  value = ((value ^ (value >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK_64;
  value = ((value ^ (value >> 27n)) * 0x94d049bb133111ebn) & MASK_64;
  value ^= value >> 31n;
  return Number((value & MASK_64) >> 11n) / UINT_53_RANGE;
}

function interpolate(bounds, unit) {
  return bounds.min + (bounds.max - bounds.min) * unit;
}

function freezeParticleView(particle, presentationTimeMs) {
  const ageMs = Math.max(0, presentationTimeMs - particle.startedAtPresentationMs);
  const ageSeconds = ageMs / 1_000;
  const distance = particle.speedPxPerSecond * ageSeconds;
  const radians = particle.angleDegrees * Math.PI / 180;
  return Object.freeze({
    id: particle.id,
    origin: particle.origin,
    ageMs,
    lifetimeMs: particle.lifetimeMs,
    offsetX: Math.cos(radians) * distance,
    offsetY: Math.sin(radians) * distance + 0.5 * particle.gravityPxPerSecondSquared * ageSeconds * ageSeconds,
    sizePx: particle.sizePx,
    color: particle.color,
    alpha: Math.max(0, Math.min(1, 1 - ageMs / particle.lifetimeMs)),
    blendMode: particle.blendMode
  });
}

function cameraEnd(start, cue) {
  return start + Math.max(cue.shake?.durationMs ?? 0, cue.hitStop?.durationMs ?? 0, cue.chromaticAberration?.durationMs ?? 0);
}

class ProceduralJuicePresentationRuntime {
  constructor(options = {}) {
    const preference = ownData(options, "motionPreference");
    this.motionPreference = ["full", "reduced", "off"].includes(preference) ? preference : "full";
    this.wallTimeMs = 0;
    this.presentationTimeMs = 0;
    this.particles = [];
    this.cameraCues = [];
    this.audioQueue = [];
    this.rememberedFrames = new Set();
  }

  ingest(frame, options = {}) {
    const projection = compileProjection(frame);
    if (!projection) return EMPTY_INGEST_RESULT;
    const frameKey = canonicalFrameKey(ownData(options, "frameKey") ?? projectionFrameKey(projection));
    if (!frameKey || this.rememberedFrames.has(frameKey)) return EMPTY_INGEST_RESULT;
    this.rememberFrame(frameKey);
    this.prune();

    let particlesAdded = 0;
    let audioAdded = 0;
    let camerasAdded = 0;
    const density = this.motionPreference === "reduced" ? PROCEDURAL_JUICE_RUNTIME_LIMITS.reducedParticleDensity : 1;
    if (this.motionPreference !== "off") {
      for (let burstIndex = 0; burstIndex < projection.particleBursts.length; burstIndex += 1) {
        const burst = projection.particleBursts[burstIndex];
        const desired = Math.max(1, Math.ceil(burst.count * density));
        for (let particleIndex = 0; particleIndex < desired; particleIndex += 1) {
          if (this.particles.length >= PROCEDURAL_JUICE_RUNTIME_LIMITS.liveParticles) break;
          this.particles.push(Object.freeze({
            id: `${frameKey}:particle:${burstIndex}:${particleIndex}:${burst.seed}`,
            origin: burst.origin,
            startedAtPresentationMs: this.presentationTimeMs,
            lifetimeMs: interpolate(burst.lifetimeMs, seededUnit(burst.seed, particleIndex, 0)),
            speedPxPerSecond: interpolate(burst.speedPxPerSecond, seededUnit(burst.seed, particleIndex, 1)),
            angleDegrees: interpolate(burst.angleDegrees, seededUnit(burst.seed, particleIndex, 2)),
            sizePx: interpolate(burst.sizePx, seededUnit(burst.seed, particleIndex, 3)),
            color: burst.color,
            gravityPxPerSecondSquared: burst.gravityPxPerSecondSquared,
            blendMode: burst.blendMode
          }));
          particlesAdded += 1;
        }
        if (this.particles.length >= PROCEDURAL_JUICE_RUNTIME_LIMITS.liveParticles) break;
      }
    }

    const voiceCapacity = Math.min(
      PROCEDURAL_JUICE_RUNTIME_LIMITS.audioVoicesPerFrame,
      PROCEDURAL_JUICE_RUNTIME_LIMITS.queuedAudioVoices - this.audioQueue.length
    );
    for (let index = 0; index < projection.audioCues.length && audioAdded < voiceCapacity; index += 1) {
      this.audioQueue.push(Object.freeze({
        occurrenceId: `${frameKey}:audio:${index}:${projection.audioCues[index].seed}`,
        ...projection.audioCues[index]
      }));
      audioAdded += 1;
    }

    if (this.motionPreference !== "off") {
      for (let index = 0; index < projection.cameraCues.length; index += 1) {
        if (this.cameraCues.length >= PROCEDURAL_JUICE_RUNTIME_LIMITS.activeCameraCues) break;
        const cue = projection.cameraCues[index];
        const reducedCue = this.motionPreference === "reduced"
          ? Object.freeze({ bindingId: cue.bindingId, cueId: cue.cueId, origin: cue.origin, ...(cue.shake ? { shake: cue.shake } : {}) })
          : cue;
        if (!reducedCue.shake && !reducedCue.hitStop && !reducedCue.chromaticAberration) continue;
        this.cameraCues.push(Object.freeze({
          ...reducedCue,
          seed: cue.seed,
          startedAtWallMs: this.wallTimeMs,
          endsAtWallMs: cameraEnd(this.wallTimeMs, reducedCue)
        }));
        camerasAdded += 1;
      }
    }
    return Object.freeze({ particles: particlesAdded, audioCues: audioAdded, cameraCues: camerasAdded });
  }

  advance(deltaMs) {
    if (!Number.isFinite(deltaMs) || deltaMs < 0) return this.read();
    let remaining = deltaMs;
    while (remaining > 0) {
      const hitStops = this.activeHitStops();
      const scale = hitStops.length > 0 ? Math.min(...hitStops.map((cue) => cue.hitStop.timeScale)) : 1;
      const nextEnd = hitStops.length > 0 ? Math.min(...hitStops.map((cue) => cue.startedAtWallMs + cue.hitStop.durationMs)) : Infinity;
      const segment = Math.min(remaining, Math.max(0, nextEnd - this.wallTimeMs));
      if (segment === 0) {
        this.wallTimeMs = nextEnd;
        this.prune();
        continue;
      }
      this.presentationTimeMs += segment * scale;
      this.wallTimeMs += segment;
      remaining -= segment;
      this.prune();
    }
    return this.read();
  }

  read() {
    this.prune();
    const particles = Object.freeze(this.particles.map((particle) => freezeParticleView(particle, this.presentationTimeMs)));
    const timeScale = this.currentTimeScale();
    const shakeOffset = this.currentShakeOffset();
    const chromaticAberration = this.currentChromaticAberration();
    return Object.freeze({
      active: particles.length > 0 || this.cameraCues.length > 0,
      motionPreference: this.motionPreference,
      wallTimeMs: this.wallTimeMs,
      presentationTimeMs: this.presentationTimeMs,
      timeScale,
      particles,
      shakeOffset,
      chromaticAberration
    });
  }

  drainAudioCues() {
    const drained = Object.freeze([...this.audioQueue]);
    this.audioQueue.length = 0;
    return drained;
  }

  setMotionPreference(preference) {
    if (!["full", "reduced", "off"].includes(preference) || preference === this.motionPreference) return this.read();
    this.motionPreference = preference;
    if (preference === "off") {
      this.particles.length = 0;
      this.cameraCues.length = 0;
    } else if (preference === "reduced") {
      const allowed = Math.ceil(PROCEDURAL_JUICE_RUNTIME_LIMITS.liveParticles * PROCEDURAL_JUICE_RUNTIME_LIMITS.reducedParticleDensity);
      this.particles.length = Math.min(this.particles.length, allowed);
      this.cameraCues = this.cameraCues
        .filter((cue) => cue.shake)
        .map((cue) => Object.freeze({ ...cue, hitStop: undefined, chromaticAberration: undefined }));
    }
    return this.read();
  }

  reset() {
    this.wallTimeMs = 0;
    this.presentationTimeMs = 0;
    this.particles.length = 0;
    this.cameraCues.length = 0;
    this.audioQueue.length = 0;
    this.rememberedFrames.clear();
    return this.read();
  }

  rememberFrame(frameKey) {
    this.rememberedFrames.add(frameKey);
    if (this.rememberedFrames.size <= PROCEDURAL_JUICE_RUNTIME_LIMITS.rememberedFrames) return;
    const oldest = this.rememberedFrames.values().next().value;
    this.rememberedFrames.delete(oldest);
  }

  activeHitStops() {
    if (this.motionPreference !== "full") return [];
    return this.cameraCues.filter((cue) => cue.hitStop && this.wallTimeMs < cue.startedAtWallMs + cue.hitStop.durationMs);
  }

  currentTimeScale() {
    const active = this.activeHitStops();
    return active.length > 0 ? Math.min(...active.map((cue) => cue.hitStop.timeScale)) : 1;
  }

  currentShakeOffset() {
    if (this.motionPreference === "off") return Object.freeze({ x: 0, y: 0 });
    let x = 0;
    let y = 0;
    for (const cue of this.cameraCues) {
      if (!cue.shake || this.wallTimeMs >= cue.startedAtWallMs + cue.shake.durationMs) continue;
      const elapsedSeconds = (this.wallTimeMs - cue.startedAtWallMs) / 1_000;
      const remaining = 1 - (this.wallTimeMs - cue.startedAtWallMs) / cue.shake.durationMs;
      const phaseX = seededUnit(cue.seed, 0, 0) * Math.PI * 2;
      const phaseY = seededUnit(cue.seed, 0, 1) * Math.PI * 2;
      const frequency = 8 + seededUnit(cue.seed, 0, 2) * 8;
      const magnitude = cue.shake.intensity * remaining;
      x += Math.sin(phaseX + elapsedSeconds * frequency * Math.PI * 2) * magnitude;
      y += Math.cos(phaseY + elapsedSeconds * frequency * Math.PI * 2) * magnitude;
    }
    const cap = this.motionPreference === "reduced" ? PROCEDURAL_JUICE_RUNTIME_LIMITS.reducedShakeMagnitude : 1;
    const magnitude = Math.hypot(x, y);
    if (magnitude > cap && magnitude > 0) {
      x = x / magnitude * cap;
      y = y / magnitude * cap;
    }
    return Object.freeze({ x, y });
  }

  currentChromaticAberration() {
    if (this.motionPreference !== "full") return 0;
    let greatest = 0;
    for (const cue of this.cameraCues) {
      if (cue.chromaticAberration && this.wallTimeMs < cue.startedAtWallMs + cue.chromaticAberration.durationMs) {
        greatest = Math.max(greatest, cue.chromaticAberration.intensity);
      }
    }
    return greatest;
  }

  prune() {
    this.particles = this.particles.filter((particle) => this.presentationTimeMs - particle.startedAtPresentationMs < particle.lifetimeMs);
    this.cameraCues = this.cameraCues.filter((cue) => this.wallTimeMs < cue.endsAtWallMs);
  }
}

class ProceduralJuiceWorldSnapshotBuffer {
  constructor() {
    this.reset();
  }

  select({ snapshot, previousSnapshot, frame, deltaMs }) {
    if (snapshot === null || typeof snapshot !== "object") return snapshot;
    const wallTimeMs = ownData(frame, "wallTimeMs");
    const presentationTimeMs = ownData(frame, "presentationTimeMs");
    const timeScale = ownData(frame, "timeScale");
    const safeDeltaMs = Number.isFinite(deltaMs) && deltaMs >= 0 ? deltaMs : 0;
    if (!finite(wallTimeMs, 0, Number.MAX_SAFE_INTEGER)
      || !finite(presentationTimeMs, 0, Number.MAX_SAFE_INTEGER)
      || !finite(timeScale, Number.MIN_VALUE, 1)
      || timeScale >= 1) {
      this.reset();
      return snapshot;
    }

    if (!this.holding) {
      this.holding = true;
      this.startedAtPresentationMs = presentationTimeMs;
      this.capturedSourceMs = 0;
      this.samples.push(Object.freeze({
        sourceTimeMs: 0,
        snapshot: previousSnapshot !== null && typeof previousSnapshot === "object" ? previousSnapshot : snapshot
      }));
    }

    this.capturedSourceMs += Math.max(1, safeDeltaMs);
    this.samples.push(Object.freeze({ sourceTimeMs: this.capturedSourceMs, snapshot }));
    if (this.samples.length > PROCEDURAL_JUICE_RUNTIME_LIMITS.bufferedWorldSnapshots) this.samples.shift();

    const targetSourceMs = Math.max(0, presentationTimeMs - this.startedAtPresentationMs);
    let selected = this.samples[0]?.snapshot ?? snapshot;
    for (const sample of this.samples) {
      if (sample.sourceTimeMs > targetSourceMs) break;
      selected = sample.snapshot;
    }
    return selected;
  }

  reset() {
    this.holding = false;
    this.startedAtPresentationMs = 0;
    this.capturedSourceMs = 0;
    this.samples = [];
  }
}

export function createProceduralJuicePresentationRuntime(options) {
  return new ProceduralJuicePresentationRuntime(options);
}

export function createProceduralJuiceWorldSnapshotBuffer() {
  return new ProceduralJuiceWorldSnapshotBuffer();
}
