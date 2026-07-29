import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyProceduralJuiceAuthoring,
  getProceduralJuiceRecipe,
  inspectProceduralJuiceAuthoring,
  previewProceduralJuiceAuthoring,
  proceduralJuiceAuthoringRevision
} from "./procedural-juice-authoring.mjs";

const STARTER = path.resolve("examples/starter.tdproj");
const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r11-juice-authoring-"));
  roots.push(root);
  fs.cpSync(STARTER, root, { recursive: true });
  return root;
}

function sourceBytes(projectDir) {
  return {
    project: fs.readFileSync(path.join(projectDir, "project.json")),
    visuals: fs.readFileSync(path.join(projectDir, "content", "visuals.json"))
  };
}

function expectSameBytes(actual, expected) {
  expect(actual.project.equals(expected.project)).toBe(true);
  expect(actual.visuals.equals(expected.visuals)).toBe(true);
}

function candidate() {
  return getProceduralJuiceRecipe("impact_feedback", { missionIds: ["tutorial_01"] }).proceduralJuice;
}

describe("R11 guarded procedural juice CLI authoring contract (RED)", () => {
  it("reads exact opt-in state and returns detached recipes without writing", async () => {
    const projectDir = fixture();
    const before = sourceBytes(projectDir);
    const inspected = await inspectProceduralJuiceAuthoring(projectDir);
    expect(inspected).toMatchObject({
      schemaVersion: 1,
      authored: false,
      active: false,
      revision: expect.stringMatching(/^[a-f0-9]{64}$/),
      counts: { particleEmitters: 0, audioCues: 0, cameraCues: 0, eventBindings: 0 }
    });
    expect(proceduralJuiceAuthoringRevision(projectDir)).toBe(inspected.revision);

    const first = getProceduralJuiceRecipe("impact_feedback", { missionIds: ["tutorial_01"] });
    first.proceduralJuice.particleEmitters.impact_sparks.maxParticles = 1;
    const second = getProceduralJuiceRecipe("impact_feedback", { missionIds: ["tutorial_01"] });
    expect(second).toMatchObject({ schemaVersion: 1, recipeId: "impact_feedback", detached: true });
    expect(second.proceduralJuice.particleEmitters.impact_sparks.maxParticles).toBeGreaterThan(1);
    expect(getProceduralJuiceRecipe("boss_finisher", {
      missionIds: [`chapter.${"x".repeat(129)}`],
      enemyTypeIds: ["__proto__"]
    }).proceduralJuice.eventBindings.boss_death).toMatchObject({
      missionIds: [`chapter.${"x".repeat(129)}`],
      enemyTypeIds: ["__proto__"]
    });
    expectSameBytes(sourceBytes(projectDir), before);
  });

  it("previews with no writes, then promotes project and visuals to v3 through an exact revision", async () => {
    const projectDir = fixture();
    const before = sourceBytes(projectDir);
    const preview = await previewProceduralJuiceAuthoring(projectDir, { proceduralJuice: candidate() });
    expect(preview).toMatchObject({
      ok: true,
      dryRun: true,
      written: false,
      revision: expect.stringMatching(/^[a-f0-9]{64}$/),
      candidate: {
        manifest: { schemaVersion: 3 },
        visuals: { schemaVersion: 3, proceduralJuice: { schemaVersion: 1 } }
      },
      validation: { ok: true }
    });
    expectSameBytes(sourceBytes(projectDir), before);

    const applied = await applyProceduralJuiceAuthoring(projectDir, {
      proceduralJuice: candidate(),
      ifRevision: preview.revision
    });
    expect(applied).toMatchObject({
      ok: true,
      written: true,
      rolledBack: false,
      previousRevision: preview.revision,
      backup: { directory: expect.any(String) }
    });
    expect(applied.revision).not.toBe(preview.revision);
    expect(JSON.parse(fs.readFileSync(path.join(projectDir, "project.json"), "utf8")).schemaVersion).toBe(3);
    expect(JSON.parse(fs.readFileSync(path.join(projectDir, "content", "visuals.json"), "utf8"))).toMatchObject({
      schemaVersion: 3,
      proceduralJuice: { schemaVersion: 1 }
    });
  });

  it("rejects stale, malformed, future, accessor and cyclic requests without writes", async () => {
    const projectDir = fixture();
    const current = proceduralJuiceAuthoringRevision(projectDir);
    fs.appendFileSync(path.join(projectDir, "content", "visuals.json"), "\n");
    const afterExternalEdit = sourceBytes(projectDir);
    await expect(applyProceduralJuiceAuthoring(projectDir, {
      proceduralJuice: candidate(),
      ifRevision: current
    })).resolves.toMatchObject({ ok: false, conflict: true, expectedRevision: current });
    expectSameBytes(sourceBytes(projectDir), afterExternalEdit);

    for (const invalid of [
      { ...candidate(), schemaVersion: 2 },
      { ...candidate(), hostCode: "eval('no')" }
    ]) {
      const before = sourceBytes(projectDir);
      const preview = await previewProceduralJuiceAuthoring(projectDir, { proceduralJuice: invalid });
      expect(preview).toMatchObject({ ok: false, written: false, validation: { ok: false } });
      expectSameBytes(sourceBytes(projectDir), before);
    }

    const accessor = {};
    Object.defineProperty(accessor, "schemaVersion", { enumerable: true, get() { throw new Error("must not run"); } });
    const accessorResult = await previewProceduralJuiceAuthoring(projectDir, { proceduralJuice: accessor });
    expect(accessorResult).toMatchObject({ ok: false, validation: { ok: false } });

    const cyclic = candidate();
    cyclic.self = cyclic;
    const cyclicResult = await previewProceduralJuiceAuthoring(projectDir, { proceduralJuice: cyclic });
    expect(cyclicResult).toMatchObject({ ok: false, validation: { ok: false } });

    const target = {};
    const revoked = Proxy.revocable(target, {});
    revoked.revoke();
    const proxyResult = await previewProceduralJuiceAuthoring(projectDir, { proceduralJuice: revoked.proxy });
    expect(proxyResult).toMatchObject({ ok: false, validation: { ok: false } });

    const oversizedKey = {};
    Object.defineProperty(oversizedKey, "x".repeat(1_048_577), { value: true, enumerable: true });
    const keyBudget = await previewProceduralJuiceAuthoring(projectDir, { proceduralJuice: oversizedKey });
    expect(keyBudget).toMatchObject({
      ok: false,
      validation: { issues: [expect.objectContaining({ code: "budget_exceeded" })] }
    });
    expect(keyBudget.validation.issues[0].message.length).toBeLessThan(512);
  });

  it("removes only proceduralJuice and preserves the v3 visuals catalog", async () => {
    const projectDir = fixture();
    const preview = await previewProceduralJuiceAuthoring(projectDir, { proceduralJuice: candidate() });
    const enabled = await applyProceduralJuiceAuthoring(projectDir, { proceduralJuice: candidate(), ifRevision: preview.revision });
    const disablePreview = await previewProceduralJuiceAuthoring(projectDir, { proceduralJuice: null });
    expect(disablePreview).toMatchObject({ ok: true, candidate: { visuals: { schemaVersion: 3 } } });
    expect(disablePreview.candidate.visuals).not.toHaveProperty("proceduralJuice");
    const disabled = await applyProceduralJuiceAuthoring(projectDir, { proceduralJuice: null, ifRevision: enabled.revision });
    expect(disabled).toMatchObject({ ok: true, written: true });
    const visuals = JSON.parse(fs.readFileSync(path.join(projectDir, "content", "visuals.json"), "utf8"));
    expect(visuals.schemaVersion).toBe(3);
    expect(visuals).not.toHaveProperty("proceduralJuice");
  });

  it("rolls both owned sources back when post-write validation fails", async () => {
    const projectDir = fixture();
    const before = sourceBytes(projectDir);
    const preview = await previewProceduralJuiceAuthoring(projectDir, { proceduralJuice: candidate() });
    await expect(applyProceduralJuiceAuthoring(projectDir, {
      proceduralJuice: candidate(),
      ifRevision: preview.revision
    }, {
      afterFileReplace(relativePath) {
        if (relativePath === "project.json") throw new Error("injected failure");
      }
    })).rejects.toThrow(/injected failure/i);
    expectSameBytes(sourceBytes(projectDir), before);
  });

  it("rejects a symlinked owned source", async () => {
    const projectDir = fixture();
    const visualsPath = path.join(projectDir, "content", "visuals.json");
    const target = path.join(projectDir, "visuals-target.json");
    fs.renameSync(visualsPath, target);
    fs.symlinkSync(target, visualsPath);
    expect(() => proceduralJuiceAuthoringRevision(projectDir)).toThrow(/symbolic link|symlink/i);
  });

  it("rejects a symlinked backup parent before replacing owned sources", async () => {
    const projectDir = fixture();
    const external = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r11-external-backup-"));
    roots.push(external);
    const privateDir = path.join(projectDir, ".towerforge");
    fs.rmSync(privateDir, { recursive: true, force: true });
    fs.symlinkSync(external, privateDir);
    const before = sourceBytes(projectDir);
    const preview = await previewProceduralJuiceAuthoring(projectDir, { proceduralJuice: candidate() });
    await expect(applyProceduralJuiceAuthoring(projectDir, {
      proceduralJuice: candidate(),
      ifRevision: preview.revision
    })).rejects.toThrow(/backup|symbolic link|real project directories/i);
    expectSameBytes(sourceBytes(projectDir), before);
    expect(fs.readdirSync(external)).toEqual([]);
  });
});
