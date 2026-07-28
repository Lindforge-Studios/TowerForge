import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(".");
const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function build(projectDir, outDir, singleFile = false) {
  const args = [
    path.join(repoRoot, "packages", "cli", "build.mjs"),
    "--project", projectDir,
    "--out", outDir,
    "--json"
  ];
  if (singleFile) args.push("--single-file");
  return JSON.parse(execFileSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, TOWERFORGE_BUNDLED_RUNTIME: "1" }
  }));
}

function enableLocalCoop(projectDir) {
  const manifestPath = path.join(projectDir, "project.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.schemaVersion = 3;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const balancePath = path.join(projectDir, "content", "balance.json");
  const balance = JSON.parse(fs.readFileSync(balancePath, "utf8"));
  balance.missions.tutorial_01.mechanics = { profiles: { multiplayer: "local_coop" } };
  fs.writeFileSync(balancePath, `${JSON.stringify(balance, null, 2)}\n`);
  fs.writeFileSync(path.join(projectDir, "content", "mechanics.json"), `${JSON.stringify({
    schemaVersion: 1,
    modules: {
      multiplayer: {
        schemaVersion: 1,
        enabled: true,
        profiles: {
          local_coop: {
            mode: "local_coop",
            fixedTickUnits: 0.1,
            maxPlayers: 2,
            ownership: { towerControl: "owner_only", resources: "shared", routes: "shared" }
          }
        }
      }
    }
  }, null, 2)}\n`);
}

function selectRenderer(projectDir, renderer) {
  const targetsPath = path.join(projectDir, "build-targets.json");
  const targets = JSON.parse(fs.readFileSync(targetsPath, "utf8"));
  targets.targets[targets.defaults.web].renderer = renderer;
  fs.writeFileSync(targetsPath, `${JSON.stringify(targets, null, 2)}\n`);
}

function decodedSingleFileModules(html) {
  return [...html.matchAll(/data:text\/javascript;base64,([A-Za-z0-9+/=]+)/g)]
    .map((match) => Buffer.from(match[1], "base64").toString("utf8"))
    .join("\n");
}

describe("R8 multiplayer conditional generated-player packaging", () => {
  it("omits multiplayer runtime from legacy players and includes the separate entrypoint only for an active profile", () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r8-package-"));
    roots.push(projectDir);
    fs.cpSync(path.join(repoRoot, "examples", "starter.tdproj"), projectDir, { recursive: true });

    const legacy = build(projectDir, "dist-r8-legacy");
    expect(fs.existsSync(path.join(legacy.outDir, "engine", "multiplayer"))).toBe(false);
    expect(fs.readFileSync(path.join(legacy.outDir, "player.mjs"), "utf8")).not.toContain("__towerforgeMultiplayer");

    enableLocalCoop(projectDir);
    const active = build(projectDir, "dist-r8-active", true);
    expect(fs.existsSync(path.join(active.outDir, "engine", "multiplayer", "index.js"))).toBe(true);
    const player = fs.readFileSync(path.join(active.outDir, "player.mjs"), "utf8");
    expect(player).toContain('from "./engine/multiplayer/index.js"');
    expect(player).toContain("__towerforgeMultiplayer");
    const single = fs.readFileSync(active.singleFilePath, "utf8");
    const singleModules = decodedSingleFileModules(single);
    expect(singleModules).toContain("__towerforgeMultiplayer");
    expect(singleModules).toContain("tf-match-v1");

    selectRenderer(projectDir, "phaser");
    const phaser = build(projectDir, "dist-r8-phaser");
    expect(fs.readFileSync(path.join(phaser.outDir, "player.mjs"), "utf8")).toContain(
      'from "./engine/multiplayer/index.js"'
    );
  }, 120_000);
});
