import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { packageProject } from "./lib/packaging.mjs";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function textTree(root) {
  const rows = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && !/\.(?:png|ico|icns|zip|woff2?)$/i.test(entry.name)) {
        rows.push(`${path.relative(root, absolute)}\n${fs.readFileSync(absolute, "utf8")}`);
      }
    }
  };
  visit(root);
  return rows.join("\n");
}

describe("R16 Replay Lab and relay package isolation (RED)", () => {
  it("keeps Replay Lab, ghost projection and reference relay out of every untouched starter carrier", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r16-legacy-"));
    roots.push(root);
    const projectDir = path.join(root, "starter.tdproj");
    fs.cpSync(path.resolve("examples/starter.tdproj"), projectDir, { recursive: true });
    const built = JSON.parse(execFileSync(process.execPath, [
      path.resolve("packages/cli/build.mjs"), "--project", projectDir, "--out", "dist-r16", "--single-file", "--json"
    ], { encoding: "utf8", env: { ...process.env, TOWERFORGE_BUNDLED_RUNTIME: "1" } }));
    const forbidden = /replay-lab|ReplayArchiveV1|GhostReplaySession|ReplayBranchV1|ghost-replay-presentation|reference-relay/i;
    expect(fs.existsSync(path.join(built.outDir, "engine", "replay-lab"))).toBe(false);
    expect(textTree(built.outDir)).not.toMatch(forbidden);

    for (const kind of ["mobile", "desktop"]) {
      const packaged = await packageProject(projectDir, { kind, outDir: `${kind}-r16` });
      expect(packaged.ok).toBe(true);
      expect(textTree(packaged.outDir)).not.toMatch(forbidden);
    }
  }, 120_000);
});
