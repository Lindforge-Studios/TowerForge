import { describe, expect, it } from "vitest";
import { allocatePlayerTargetId } from "./player-target-id.mjs";

describe("R18 Studio player-target identity allocation (RED)", () => {
  it("uses the desktop recipe id only when it is unoccupied", () => {
    expect(allocatePlayerTargetId({ web: { id: "web" } })).toBe("desktop-large");
  });

  it("selects the first free deterministic suffix without mutating existing targets", () => {
    const targets = {
      "desktop-large": { id: "desktop-large", appTitle: "Authored target" },
      "desktop-large-2": { id: "desktop-large-2" },
      "desktop-large-4": { id: "desktop-large-4" }
    };
    const before = structuredClone(targets);

    expect(allocatePlayerTargetId(targets)).toBe("desktop-large-3");
    expect(targets).toEqual(before);
  });

  it("fails closed after the bounded suffix budget is exhausted", () => {
    const targets = Object.fromEntries([
      ["desktop-large", { id: "desktop-large" }],
      ...Array.from({ length: 255 }, (_, index) => [
        `desktop-large-${index + 2}`,
        { id: `desktop-large-${index + 2}` }
      ])
    ]);

    expect(() => allocatePlayerTargetId(targets)).toThrow(/free desktop target id/i);
  });
});
