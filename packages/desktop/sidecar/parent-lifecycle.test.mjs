import { describe, expect, it, vi } from "vitest";
import { createParentProcessWatch, parseParentPid } from "./parent-lifecycle.mjs";

describe("desktop sidecar parent lifecycle", () => {
  it("accepts only a positive integer parent pid", () => {
    expect(parseParentPid("42")).toBe(42);
    expect(parseParentPid("0")).toBeNull();
    expect(parseParentPid("12.5")).toBeNull();
    expect(parseParentPid("nope")).toBeNull();
    expect(parseParentPid(undefined)).toBeNull();
  });

  it("stops the sidecar once its desktop parent disappears", () => {
    let poll;
    const clear = vi.fn();
    const onMissing = vi.fn();
    const watch = createParentProcessWatch({
      parentPid: 42,
      probe: vi.fn(() => { throw Object.assign(new Error("missing"), { code: "ESRCH" }); }),
      onMissing,
      setIntervalFn(callback) {
        poll = callback;
        return { unref: vi.fn() };
      },
      clearIntervalFn: clear
    });

    poll();
    poll();
    expect(onMissing).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalledTimes(1);
    watch.stop();
  });

  it("keeps watching while the desktop parent is alive", () => {
    let poll;
    const onMissing = vi.fn();
    const probe = vi.fn();
    const watch = createParentProcessWatch({
      parentPid: 42,
      probe,
      onMissing,
      setIntervalFn(callback) {
        poll = callback;
        return { unref: vi.fn() };
      },
      clearIntervalFn: vi.fn()
    });

    poll();
    expect(probe).toHaveBeenCalledWith(42, 0);
    expect(onMissing).not.toHaveBeenCalled();
    watch.stop();
  });
});
