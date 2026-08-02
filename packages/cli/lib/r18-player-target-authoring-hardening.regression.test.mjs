import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyPlayerTarget,
  getPlayerTargetRecipe,
  previewPlayerTarget,
  readPlayerTargets
} from "./player-target-authoring.mjs";

const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("R18 direct player-target hostile input hardening (RED)", () => {
  it.each([
    ["accessor", accessorCandidate],
    ["Proxy", proxyCandidate],
    ["symbol key", symbolCandidate],
    ["sparse array", sparseCandidate],
    ["cyclic object", cyclicCandidate],
    ["over-budget object", overBudgetCandidate]
  ])("rejects %s before executing input code or writing", (_label, candidateFactory) => {
    const projectDir = fixture();
    const recipe = getPlayerTargetRecipe(projectDir, "desktop_large_screen", "desktop-secure");
    const revision = readPlayerTargets(projectDir).revision;
    const before = projectSnapshot(projectDir);

    for (const operation of [
      (target) => previewPlayerTarget(projectDir, "desktop-secure", target),
      (target) => applyPlayerTarget(projectDir, "desktop-secure", target, { ifRevision: revision })
    ]) {
      const probe = { getterCalls: 0, trapCalls: 0 };
      const target = candidateFactory({ ...recipe.target }, probe);
      let rejected = false;
      try {
        const result = operation(target);
        rejected = result?.ok === false && result?.written !== true;
      } catch {
        rejected = true;
      }
      expect(rejected).toBe(true);
      expect(probe).toEqual({ getterCalls: 0, trapCalls: 0 });
      expect(projectSnapshot(projectDir)).toEqual(before);
    }
  });
});

function accessorCandidate(target, probe) {
  Object.defineProperty(target, "appTitle", {
    enumerable: true,
    configurable: true,
    get() {
      probe.getterCalls += 1;
      throw new Error("accessor must not execute");
    }
  });
  return target;
}

function proxyCandidate(target, probe) {
  return new Proxy(target, {
    get() { probe.trapCalls += 1; throw new Error("get trap must not execute"); },
    ownKeys() { probe.trapCalls += 1; throw new Error("ownKeys trap must not execute"); },
    getOwnPropertyDescriptor() { probe.trapCalls += 1; throw new Error("descriptor trap must not execute"); },
    getPrototypeOf() { probe.trapCalls += 1; throw new Error("prototype trap must not execute"); }
  });
}

function symbolCandidate(target) {
  target[Symbol("hidden")] = "must reject";
  return target;
}

function sparseCandidate() {
  const target = new Array(2);
  target[1] = "desktop";
  return target;
}

function cyclicCandidate(target) {
  target.cycle = target;
  return target;
}

function overBudgetCandidate(target) {
  for (let index = 0; index < 64; index += 1) target[`extra_${index}`] = index;
  return target;
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r18-target-hardening-"));
  roots.push(root);
  const projectDir = path.join(root, "starter.tdproj");
  fs.cpSync(path.resolve("examples/starter.tdproj"), projectDir, { recursive: true });
  return projectDir;
}

function projectSnapshot(projectDir) {
  const rows = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) rows.push([path.relative(projectDir, absolute), fs.readFileSync(absolute).toString("base64")]);
    }
  };
  visit(projectDir);
  return rows;
}
