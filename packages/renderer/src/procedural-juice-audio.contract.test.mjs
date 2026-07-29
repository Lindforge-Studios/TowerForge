import { describe, expect, it, vi } from "vitest";
import { createAudioPlayer } from "./audio.mjs";

function event(type = "enemyHit") {
  return { type, enemyId: "enemy_1", damage: 12 };
}

function cue(overrides = {}) {
  return {
    bindingId: "impact",
    cueId: "impact_tone",
    eventType: "enemyHit",
    seed: "0000000000000001",
    waveform: "triangle",
    frequencyHz: 330,
    durationMs: 120,
    gain: 0.25,
    ...overrides
  };
}

describe("R11 procedural audio adapter", () => {
  it("uses a matching bounded procedural voice before the legacy synth fallback", () => {
    const player = createAudioPlayer();
    player.ensureContext = vi.fn(() => { player.ctx = {}; });
    player.playProceduralCue = vi.fn(() => true);
    player.playFor = vi.fn();

    player.handleEvents([event()], { proceduralCues: [cue()] });

    expect(player.playProceduralCue).toHaveBeenCalledOnce();
    expect(player.playFor).not.toHaveBeenCalledWith("enemyHit", expect.anything());
  });

  it("keeps an available imported event asset ahead of a procedural cue", () => {
    const player = createAudioPlayer({
      audio: { sounds: { impact: { src: "assets/impact.ogg" } }, events: { enemyHit: "impact" } }
    });
    player.ctx = {};
    player.master = {};
    player.buffers.set("assets/impact.ogg", { decoded: true });
    player.playBuffer = vi.fn();
    player.playProceduralCue = vi.fn(() => true);
    player.playFor = vi.fn();

    player.handleEvents([event()], { proceduralCues: [cue()] });

    expect(player.playBuffer).toHaveBeenCalledOnce();
    expect(player.playProceduralCue).not.toHaveBeenCalled();
    expect(player.playFor).not.toHaveBeenCalled();
  });

  it("caps new procedural voices at 32 and fails closed for malformed instructions", () => {
    const player = createAudioPlayer();
    player.ensureContext = vi.fn(() => { player.ctx = {}; });
    player.playProceduralCue = vi.fn((instruction) => Number.isFinite(instruction.frequencyHz));
    player.playFor = vi.fn();
    const proceduralCues = Array.from({ length: 40 }, (_, index) => cue({
      cueId: `voice_${index}`,
      seed: index.toString(16).padStart(16, "0")
    }));
    proceduralCues.unshift(cue({ cueId: "broken", frequencyHz: Infinity }));

    player.handleEvents([event()], { proceduralCues });

    expect(player.playProceduralCue).toHaveBeenCalledTimes(32);
    expect(player.playProceduralCue).not.toHaveBeenCalledWith(expect.objectContaining({ cueId: "broken" }), expect.anything());
  });

  it("bounds live procedural Web Audio nodes across repeated frames and releases ended voices", () => {
    const player = createAudioPlayer();
    player.ctx = {};
    const handles = [];
    player.tone = vi.fn(() => {
      const source = { onended: null };
      const handle = { source, disconnect: vi.fn() };
      handles.push(handle);
      return handle;
    });

    for (let index = 0; index < 40; index += 1) {
      player.playProceduralCue(cue({ seed: index.toString(16).padStart(16, "0"), durationMs: 10_000 }));
    }

    expect(player.tone).toHaveBeenCalledTimes(32);
    expect(player.proceduralVoices.size).toBe(32);
    handles[0].source.onended();
    expect(handles[0].disconnect).toHaveBeenCalledOnce();
    expect(player.proceduralVoices.size).toBe(31);
    expect(player.playProceduralCue(cue({ seed: "ffffffffffffffff", durationMs: 10_000 }))).toBe(true);
    expect(player.proceduralVoices.size).toBe(32);
    player.playFor = vi.fn();
    player.handleEvents([event()], { proceduralCues: [cue({ durationMs: 10_000 })] });
    expect(player.playFor).not.toHaveBeenCalled();
  });

  it("rejects noise before AudioBuffer allocation when the global live-sample budget is exhausted", () => {
    const player = createAudioPlayer();
    player.ctx = { sampleRate: 96_000 };
    const handles = [];
    player.noise = vi.fn(() => {
      const handle = { source: { onended: null }, disconnect: vi.fn() };
      handles.push(handle);
      return handle;
    });
    const longNoise = cue({ waveform: "noise", durationMs: 10_000 });

    expect(player.playProceduralCue(longNoise)).toBe(true);
    expect(player.playProceduralCue(cue({ ...longNoise, seed: "0000000000000002" }))).toBe(false);
    expect(player.noise).toHaveBeenCalledTimes(1);
    handles[0].source.onended();
    expect(player.playProceduralCue(cue({ ...longNoise, seed: "0000000000000003" }))).toBe(true);
  });

  it("preserves the legacy event path when no valid procedural cue matches", () => {
    const player = createAudioPlayer();
    player.ensureContext = vi.fn(() => { player.ctx = {}; });
    player.playFor = vi.fn();

    player.handleEvents([event()], { proceduralCues: [] });

    expect(player.playFor).toHaveBeenCalledWith("enemyHit");
  });
});
