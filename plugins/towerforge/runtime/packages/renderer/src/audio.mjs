// audio.mjs — zero-dependency procedural SFX for the player and Studio playtest.
//
// Synthesizes every sound with the Web Audio API (no asset files), driven by engine event types
// from a snapshot's `lastEvents`. Events are coalesced per frame so rapid fire doesn't turn into a
// cacophony. The AudioContext is created lazily and resumed on the first user gesture.

/** Canonical list of game actions that can carry a sound (synth default, overridable per project). */
export const AUDIO_EVENTS = [
  { id: "towerPlaced", label: "Place tower" },
  { id: "towerUpgraded", label: "Upgrade tower" },
  { id: "towerFired", label: "Tower fires" },
  { id: "enemyHit", label: "Enemy hit" },
  { id: "enemyKilled", label: "Enemy killed" },
  { id: "enemyLeaked", label: "Enemy leaks (core hit)" },
  { id: "areaPulse", label: "Area pulse" },
  { id: "waveStarted", label: "Wave starts" },
  { id: "victory", label: "Victory" },
  { id: "defeat", label: "Defeat" }
];

const MAX_LIVE_PROCEDURAL_AUDIO_VOICES = 32;
const MAX_LIVE_PROCEDURAL_NOISE_SAMPLES = 1_000_000;

function proceduralCueData(cue) {
  let descriptors;
  try {
    if (!cue || typeof cue !== "object" || Array.isArray(cue)) return undefined;
    descriptors = Object.getOwnPropertyDescriptors(cue);
  } catch { return undefined; }
  const value = (key) => {
    const descriptor = descriptors[key];
    return descriptor?.enumerable === true && "value" in descriptor ? descriptor.value : undefined;
  };
  const data = {
    eventType: value("eventType"), waveform: value("waveform"), frequencyHz: value("frequencyHz"),
    durationMs: value("durationMs"), gain: value("gain"), seed: value("seed")
  };
  if (typeof data.eventType !== "string"
    || !["sine", "triangle", "square", "sawtooth", "noise"].includes(data.waveform)
    || !Number.isFinite(data.frequencyHz) || data.frequencyHz < 20 || data.frequencyHz > 20_000
    || !Number.isFinite(data.durationMs) || data.durationMs < 1 || data.durationMs > 10_000
    || !Number.isFinite(data.gain) || data.gain < 0 || data.gain > 1
    || typeof data.seed !== "string" || !/^[0-9a-f]{16}$/i.test(data.seed)) return undefined;
  return data;
}

export function createAudioPlayer(options = {}) {
  return new TowerForgeAudio(options);
}

export class TowerForgeAudio {
  constructor(options = {}) {
    this.enabled = options.enabled !== false;
    this.volume = typeof options.volume === "number" ? options.volume : 0.5;
    this.musicVolume = typeof options.musicVolume === "number" ? options.musicVolume : 0.35;
    this.ctx = null;
    this.master = null;
    this.musicMaster = null;
    this.musicSource = null;
    this.currentMusicId = null;
    this.desiredMusicId = null;
    this.musicLoadToken = 0;
    // Custom-sound catalog: { sounds: { id: { src } }, events: { eventType: soundId } }
    this.audio = options.audio || null;
    this.assetBase = options.assetBase ?? "";
    this.buffers = new Map(); // src -> decoded AudioBuffer
    this.loading = new Set();
    this.proceduralVoices = new Set();
    this.proceduralNoiseSamples = 0;
  }

  /** Swap the custom-sound catalog (e.g. when the project is re-loaded in the Studio playtest). */
  setCatalog(audio, assetBase) {
    this.audio = audio || null;
    if (typeof assetBase === "string") this.assetBase = assetBase;
    this.preload();
    this.ensureMusic();
  }

  setEnabled(enabled) {
    this.enabled = !!enabled;
    if (!this.enabled) this.suspend();
    else if (this.ctx) this.resume();
  }

  setVolumes(sfxVolume, musicVolume) {
    if (Number.isFinite(sfxVolume)) this.volume = Math.max(0, Math.min(1, sfxVolume));
    if (Number.isFinite(musicVolume)) this.musicVolume = Math.max(0, Math.min(1, musicVolume));
    if (this.master) this.master.gain.value = this.volume;
    if (this.musicMaster) this.musicMaster.gain.value = this.musicVolume;
  }

  selectMusic(trackId) {
    const next = typeof trackId === "string" && trackId ? trackId : null;
    if (this.desiredMusicId === next && this.currentMusicId === next) return;
    this.desiredMusicId = next;
    this.musicLoadToken += 1;
    this.stopMusicSource();
    if (this.enabled && next && this.ctx) this.ensureMusic();
  }

  /** Must be called from a user gesture (click/keydown) before sound can play in most browsers. */
  resume() {
    this.ensureContext();
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
    this.preload();
    this.ensureMusic();
  }

  /** Suspend the AudioContext when the app is backgrounded (mobile). Frees the audio hardware and
   *  stops synthesis while hidden — real battery savings in a wrapped APK; safe no-op on desktop. */
  suspend() {
    this.disposeProceduralVoices();
    if (this.ctx && this.ctx.state === "running") this.ctx.suspend().catch(() => {});
  }

  // ── custom sounds ──────────────────────────────────────────────────────────
  eventSrc(eventType) {
    const soundId = this.audio && this.audio.events ? this.audio.events[eventType] : null;
    if (!soundId) return null;
    const sound = this.audio.sounds ? this.audio.sounds[soundId] : null;
    return sound && typeof sound.src === "string" ? sound.src : null;
  }
  assetUrl(src) {
    const value = String(src ?? "");
    if (/^(?:data:|blob:|https?:)/i.test(value)) return value;
    return this.assetBase + value.split("/").map(encodeURIComponent).join("/");
  }
  async preload() {
    if (!this.audio || !this.audio.events) return;
    if (!this.ctx || typeof globalThis.fetch !== "function") return;
    const srcs = new Set();
    for (const eventType of Object.keys(this.audio.events)) { const s = this.eventSrc(eventType); if (s) srcs.add(s); }
    for (const src of srcs) {
      if (this.buffers.has(src) || this.loading.has(src)) continue;
      this.loading.add(src);
      try {
        const res = await globalThis.fetch(this.assetUrl(src));
        const arr = await res.arrayBuffer();
        this.buffers.set(src, await this.ctx.decodeAudioData(arr));
      } catch { /* keep the synth fallback */ }
      this.loading.delete(src);
    }
  }
  async ensureMusic() {
    const trackId = this.desiredMusicId;
    if (!this.enabled || !trackId || this.currentMusicId === trackId || !this.audio?.musicTracks?.[trackId]) return;
    if (!this.ctx || !this.musicMaster || typeof globalThis.fetch !== "function") return;
    const track = this.audio.musicTracks[trackId];
    const src = track?.src;
    if (typeof src !== "string" || !src) return;
    const token = ++this.musicLoadToken;
    let buffer = this.buffers.get(src);
    if (!buffer) {
      try {
        const res = await globalThis.fetch(this.assetUrl(src));
        if (res.ok === false) return;
        buffer = await this.ctx.decodeAudioData(await res.arrayBuffer());
        this.buffers.set(src, buffer);
      } catch { return; }
    }
    if (token !== this.musicLoadToken || this.desiredMusicId !== trackId || !this.enabled) return;
    const source = this.ctx.createBufferSource();
    const trackGain = this.ctx.createGain();
    source.buffer = buffer;
    source.loop = true;
    trackGain.gain.value = Number.isFinite(track.volume) ? Math.max(0, Math.min(1, track.volume)) : 1;
    source.connect(trackGain);
    trackGain.connect(this.musicMaster);
    source.start();
    source.onended = () => { if (this.musicSource === source) { this.musicSource = null; this.currentMusicId = null; } };
    this.musicSource = source;
    this.currentMusicId = trackId;
  }
  stopMusicSource() {
    const source = this.musicSource;
    this.musicSource = null;
    this.currentMusicId = null;
    if (source) { try { source.stop(); } catch {} }
  }
  playBuffer(buffer, delay = 0) {
    const t0 = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.master);
    src.start(t0);
  }
  /** Decode and play an arbitrary asset once (used by the Studio preview button). */
  async previewSound(src) {
    this.resume();
    if (!this.ctx) return;
    let buffer = this.buffers.get(src);
    if (!buffer) {
      try {
        const res = await globalThis.fetch(this.assetUrl(src));
        buffer = await this.ctx.decodeAudioData(await res.arrayBuffer());
        this.buffers.set(src, buffer);
      } catch { return; }
    }
    this.playBuffer(buffer);
  }
  /** Play the bound custom sound for an action, falling back to the synth default. */
  playFor(eventType, delay = 0) {
    const src = this.eventSrc(eventType);
    if (src) { const buffer = this.buffers.get(src); if (buffer) { this.playBuffer(buffer, delay); return; } }
    this.synth(eventType, delay);
  }
  /** Schedule one already-projected Procedural Juice voice. Returns false for hostile input. */
  playProceduralCue(cue, delay = 0) {
    const data = proceduralCueData(cue);
    if (!data || !Number.isFinite(delay) || delay < 0
      || this.proceduralVoices.size >= MAX_LIVE_PROCEDURAL_AUDIO_VOICES) return false;
    const dur = data.durationMs / 1000;
    let noiseSamples = 0;
    if (data.waveform === "noise") {
      const sampleRate = this.ctx?.sampleRate;
      if (!Number.isFinite(sampleRate) || sampleRate <= 0) return false;
      noiseSamples = Math.ceil(sampleRate * dur);
      if (!Number.isSafeInteger(noiseSamples) || noiseSamples < 1
        || this.proceduralNoiseSamples + noiseSamples > MAX_LIVE_PROCEDURAL_NOISE_SAMPLES) return false;
    }
    const handle = data.waveform === "noise"
      ? this.noise({ dur, gain: data.gain, freq: data.frequencyHz, delay, seed: data.seed })
      : this.tone({ freq: data.frequencyHz, type: data.waveform, dur, gain: data.gain, delay });
    return this.trackProceduralVoice(handle, noiseSamples);
  }

  trackProceduralVoice(handle, noiseSamples = 0) {
    if (!handle || typeof handle !== "object" || !handle.source || typeof handle.disconnect !== "function") return false;
    const voice = { source: handle.source, noiseSamples, release: null };
    let released = false;
    this.proceduralNoiseSamples += noiseSamples;
    voice.release = () => {
      if (released) return;
      released = true;
      this.proceduralVoices.delete(voice);
      this.proceduralNoiseSamples = Math.max(0, this.proceduralNoiseSamples - noiseSamples);
      try { handle.disconnect(); } catch {}
    };
    try { handle.source.onended = voice.release; } catch { voice.release(); return false; }
    this.proceduralVoices.add(voice);
    return true;
  }

  disposeProceduralVoices() {
    for (const voice of [...this.proceduralVoices]) {
      try { voice.source.stop(); } catch {}
      voice.release();
    }
    this.proceduralVoices.clear();
    this.proceduralNoiseSamples = 0;
  }
  synth(eventType, delay = 0) {
    switch (eventType) {
      case "towerPlaced": this.tone({ freq: 300, glideTo: 200, type: "sine", dur: 0.12, gain: 0.12, delay }); break;
      case "towerUpgraded": this.tone({ freq: 520, glideTo: 920, type: "triangle", dur: 0.16, gain: 0.14, delay }); break;
      case "towerFired": this.shoot(delay); break;
      case "enemyHit": this.tick(delay); break;
      case "enemyKilled": this.pop(delay); break;
      case "enemyLeaked": this.thud(delay); break;
      case "areaPulse": this.sweep(delay); break;
      case "waveStarted": this.horn(delay); break;
      case "victory": this.victory(delay); break;
      case "defeat": this.defeat(delay); break;
      default: break;
    }
  }

  ensureContext() {
    if (this.ctx) return;
    const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    this.musicMaster = this.ctx.createGain();
    this.musicMaster.gain.value = this.musicVolume;
    this.musicMaster.connect(this.ctx.destination);
  }

  /** Coalesce a frame's events and apply asset > procedural cue > legacy synth precedence. */
  handleEvents(events, options = {}) {
    if (!this.enabled || !events || !events.length) return;
    this.ensureContext();
    if (!this.ctx) return;
    let eventTypes;
    try {
      eventTypes = new Set(events.flatMap((event) => {
        if (!event || typeof event !== "object") return [];
        const descriptor = Object.getOwnPropertyDescriptor(event, "type");
        return descriptor?.enumerable === true && "value" in descriptor && typeof descriptor.value === "string"
          ? [descriptor.value] : [];
      }));
    } catch { eventTypes = new Set(); }
    const handled = new Set();
    const customPlayed = new Set();
    let proceduralVoices = 0;
    let rawCues = [];
    try {
      const descriptor = options && typeof options === "object"
        ? Object.getOwnPropertyDescriptor(options, "proceduralCues")
        : undefined;
      const value = descriptor?.enumerable === true && "value" in descriptor ? descriptor.value : undefined;
      rawCues = Array.isArray(value) ? value : [];
    } catch { rawCues = []; }
    for (const cue of rawCues) {
      if (proceduralVoices >= 32) break;
      const cueData = proceduralCueData(cue);
      if (!cueData) continue;
      const eventType = cueData.eventType;
      if (typeof eventType !== "string" || !eventTypes.has(eventType)) continue;
      const src = this.eventSrc(eventType);
      const buffer = src ? this.buffers.get(src) : null;
      if (buffer) {
        if (!customPlayed.has(eventType)) this.playBuffer(buffer);
        customPlayed.add(eventType);
        handled.add(eventType);
        continue;
      }
      if (this.proceduralVoices.size >= MAX_LIVE_PROCEDURAL_AUDIO_VOICES) {
        handled.add(eventType);
        continue;
      }
      if (this.playProceduralCue(cue, proceduralVoices * 0.004)) {
        proceduralVoices += 1;
        handled.add(eventType);
      }
    }
    let fired = false, hit = false, kills = 0;
    const once = new Set();
    for (const ev of events) {
      switch (ev.type) {
        case "towerFired": fired = true; break;
        case "enemyHit": hit = true; break;
        case "enemyKilled": kills += 1; break;
        case "towerPlaced": case "towerUpgraded": case "enemyLeaked":
        case "areaPulse": case "waveStarted": case "victory": case "defeat":
          once.add(ev.type); break;
        default: break;
      }
    }
    if (fired && !handled.has("towerFired")) this.playFor("towerFired");
    if (hit && !fired && !handled.has("enemyHit")) this.playFor("enemyHit");
    if (!handled.has("enemyKilled")) for (let i = 0; i < Math.min(kills, 3); i += 1) this.playFor("enemyKilled", i * 0.04);
    for (const eventType of once) if (!handled.has(eventType)) this.playFor(eventType);
  }

  // ── synth primitives ─────────────────────────────────────────────────────────
  tone({ freq = 440, type = "sine", dur = 0.12, gain = 0.25, attack = 0.005, glideTo = null, delay = 0 } = {}) {
    if (!this.ctx) return undefined;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, glideTo), t0 + dur);
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(env); env.connect(this.master);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
    return {
      source: osc,
      disconnect() {
        try { osc.disconnect(); } catch {}
        try { env.disconnect(); } catch {}
      }
    };
  }

  noise({ dur = 0.15, gain = 0.2, freq = 1200, delay = 0, seed = "00000000000004d2" } = {}) {
    if (!this.ctx) return undefined;
    const t0 = this.ctx.currentTime + delay;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let noiseSeed;
    try { noiseSeed = Number(BigInt(`0x${seed}`) & 0x7fffffffn) || 1234; } catch { noiseSeed = 1234; }
    for (let i = 0; i < len; i += 1) { noiseSeed = (noiseSeed * 1103515245 + 12345) & 0x7fffffff; data[i] = ((noiseSeed / 0x3fffffff) - 1) * (1 - i / len); }
    const src = this.ctx.createBufferSource(); src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter(); filter.type = "bandpass"; filter.frequency.value = freq;
    const env = this.ctx.createGain(); env.gain.setValueAtTime(gain, t0); env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter); filter.connect(env); env.connect(this.master);
    src.start(t0); src.stop(t0 + dur + 0.02);
    return {
      source: src,
      disconnect() {
        try { src.disconnect(); } catch {}
        try { filter.disconnect(); } catch {}
        try { env.disconnect(); } catch {}
      }
    };
  }

  // ── default synth sounds (delay lets coalesced bursts stagger) ───────────────
  shoot(delay = 0) { this.tone({ freq: 720, glideTo: 360, type: "square", dur: 0.08, gain: 0.12, delay }); }
  tick(delay = 0) { this.tone({ freq: 520, type: "triangle", dur: 0.05, gain: 0.06, delay }); }
  pop(delay = 0) { this.tone({ freq: 380, glideTo: 760, type: "triangle", dur: 0.1, gain: 0.16, delay }); this.tone({ freq: 1180, type: "sine", dur: 0.12, gain: 0.1, delay: delay + 0.03 }); }
  thud(delay = 0) { this.tone({ freq: 150, glideTo: 60, type: "sine", dur: 0.28, gain: 0.32, delay }); this.noise({ dur: 0.18, gain: 0.12, freq: 220, delay }); }
  sweep(delay = 0) { this.noise({ dur: 0.32, gain: 0.1, freq: 900, delay }); this.tone({ freq: 300, glideTo: 900, type: "sine", dur: 0.3, gain: 0.08, delay }); }
  horn(delay = 0) { this.tone({ freq: 330, type: "sawtooth", dur: 0.22, gain: 0.16, delay }); this.tone({ freq: 440, type: "sawtooth", dur: 0.22, gain: 0.12, delay: delay + 0.06 }); }
  victory(delay = 0) { [523, 659, 784, 1047].forEach((f, i) => this.tone({ freq: f, type: "triangle", dur: 0.32, gain: 0.2, delay: delay + i * 0.12 })); }
  defeat(delay = 0) { [330, 247, 165].forEach((f, i) => this.tone({ freq: f, type: "sawtooth", dur: 0.45, gain: 0.22, delay: delay + i * 0.16 })); }
}
