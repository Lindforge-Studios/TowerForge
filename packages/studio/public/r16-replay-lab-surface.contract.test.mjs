import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const html = fs.readFileSync(path.resolve("packages/studio/public/index.html"), "utf8");
const app = fs.readFileSync(path.resolve("packages/studio/public/app.js"), "utf8");

function functionSource(source, name) {
  const start = source.indexOf(`function ${name}`);
  expect(start, `${name} must exist`).toBeGreaterThanOrEqual(0);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Unclosed function ${name}`);
}

describe("R16.3 Studio Replay Lab declarative surface contract (RED)", () => {
  it("owns an isolated read-only Replay Lab tab with timeline, ghost, fork and divergence controls", () => {
    expect(html).toMatch(/data-tab=["']replaylab["']/);
    const start = html.indexOf('<section id="tab-replaylab"');
    const end = html.indexOf("</section>", start);
    expect(start).toBeGreaterThanOrEqual(0);
    const lab = html.slice(start, end);
    for (const id of [
      "replay-lab-file", "btn-replay-lab-import", "replay-lab-timeline", "replay-lab-seek",
      "replay-lab-ghost-toggle", "btn-replay-lab-fork", "replay-lab-divergence"
    ]) expect(lab).toContain(`id="${id}"`);
    expect(lab).toMatch(/data-runtime-entrypoint=["']\/engine\/replay-lab\/index\.js["']/);
    expect(lab).toMatch(/data-project-write=["']none["']/);
  });

  it("delegates archive/ghost/branch rules to the isolated engine and contains no project write path", () => {
    expect(app).toMatch(/STUDIO_TABS[\s\S]*["']replaylab["'][\s\S]*Replay Lab/);
    expect(app).toMatch(/import\(["']\/engine\/replay-lab\/index\.js["']\)/);
    for (const api of [
      "decodeReplayArchiveV1", "createGhostReplaySessionV1", "createReplayBranchV1",
      "diagnoseReplayBranchDivergenceV1"
    ]) expect(app).toContain(api);
    const surface = ["loadReplayLabArchive", "renderReplayLab", "createReplayLabBranch"]
      .map((name) => functionSource(app, name)).join("\n");
    expect(surface).not.toMatch(/saveAll|apply[A-Z]|\/api\/(?:save|write)|ifRevision|fetch\([^)]*method:\s*["'](?:POST|PUT|PATCH|DELETE)/i);
    expect(surface).not.toMatch(/new\s+TowerDefenseGame|dispatchGameCommand|\.tick\s*\(/);
  });

  it("projects the active ghost through the shared renderer and binds the toggle to a real preview overlay", () => {
    expect(html).toContain('id="replay-lab-preview"');
    expect(html).toContain('id="replay-lab-ghost-overlay"');
    expect(app).toMatch(/import\(["']\/renderer\/index\.mjs["']\)/);
    expect(app).toContain("projectGhostReplayPresentation");
    const render = functionSource(app, "renderReplayLab");
    expect(render).toMatch(/projectGhostReplayPresentation\s*\(\s*ReplayLabUI\.frame\s*\)/);
    expect(render).toMatch(/replay-lab-(?:preview|ghost-overlay)/);
    expect(app).toMatch(/replay-lab-ghost-toggle["']\)\?*\.addEventListener\(["']change["'][\s\S]{0,300}renderReplayLab\s*\(/);
  });

  it("rebuilds the engine content registry for every archive import instead of reusing a stale cache", () => {
    const load = functionSource(app, "loadReplayLabArchive");
    expect(load).toMatch(/(?:createGameContentRegistry|rebuildReplayLabContent|createReplayLabContent)/);
    expect(load).toMatch(/candidateContent\s*=\s*(?:createGameContentRegistry|rebuildReplayLabContent|createReplayLabContent)/);
    expect(load).not.toMatch(/if\s*\(\s*!ReplayLabUI\.content|ReplayLabUI\.content\s*\?\?=/);
    expect(load.indexOf("candidateContent")).toBeLessThan(load.indexOf("decodeReplayArchiveV1"));
  });

  it("commits a candidate content/archive/ghost/frame tuple only after the complete import succeeds", () => {
    const load = functionSource(app, "loadReplayLabArchive");
    expect(load).toMatch(/const\s+candidateContent\s*=\s*createReplayLabContent\s*\(\s*\)/);
    expect(load).toMatch(/decodeReplayArchiveV1\s*\(\s*\{[\s\S]*?content:\s*candidateContent/);
    expect(load).toMatch(/const\s+candidateGhost\s*=\s*runtime\.createGhostReplaySessionV1/);
    expect(load).toMatch(/const\s+candidateFrame\s*=\s*candidateGhost\.seek\s*\(\s*0\s*\)/);

    const validationComplete = load.indexOf("candidateGhost.seek");
    for (const assignment of [
      "ReplayLabUI.content = candidateContent",
      "ReplayLabUI.archive = candidate",
      "ReplayLabUI.ghost = candidateGhost",
      "ReplayLabUI.frame = candidateFrame"
    ]) {
      expect(load, `${assignment} must commit after decode, ghost construction and initial seek`)
        .toContain(assignment);
      expect(load.indexOf(assignment)).toBeGreaterThan(validationComplete);
    }
  });
});
