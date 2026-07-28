import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrateProjectFiles, writeMigratedProjectFiles } from "../cli/lib/project-migrations.mjs";
import { readRawProjectFiles } from "../cli/lib/project-loader.mjs";
import { callTool, TOOLS } from "./tools.mjs";

const STARTER = path.resolve("examples/starter.tdproj");
const ONE_PIXEL_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r7-mcp-"));
  roots.push(projectDir);
  fs.cpSync(STARTER, projectDir, { recursive: true });
  const migration = migrateProjectFiles(readRawProjectFiles(projectDir));
  writeMigratedProjectFiles(projectDir, migration.files);
  return projectDir;
}

function projectTree(rootDir) {
  const rows = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => (
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0
    ))) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) {
        rows.push([path.relative(rootDir, absolute), fs.readFileSync(absolute).toString("base64")]);
      }
    }
  };
  visit(rootDir);
  return rows;
}

function tool(name) {
  return TOOLS.find((candidate) => candidate.name === name);
}

const MAP_SPEC = Object.freeze({
  schemaVersion: 1,
  mapId: "generated_canyon",
  seed: "generated-canyon:v1",
  grid: { kind: "square", adjacency: "cardinal" },
  width: 14,
  height: 10,
  entrances: 2,
  loops: 1,
  terrain: { buildable: "buildable", path: "path", blocked: "water" },
  buildableRatio: { min: 0.35, max: 0.75 }
});

describe("R7 Director and Generative Studio MCP authoring surface (RED)", () => {
  it("describes Director v1 as an opt-in authored policy and exposes it through mechanics discovery", async () => {
    const described = await callTool("describe_schema", { domain: "director" }, {});
    expect(described).toMatchObject({
      requestedDomain: "director",
      availableDomains: expect.arrayContaining(["director"]),
      director: {
        authoring: {
          schemaVersion: 1,
          moduleId: "director",
          supportedModuleSchemaVersions: [1],
          profile: expect.objectContaining({
            requiredFields: ["counterPool", "threatBudget", "fairness"],
            additionalProperties: false
          }),
          limits: expect.any(Object)
        },
        policy: expect.objectContaining({
          deterministic: true,
          candidateSource: "authored_counter_pool",
          mutationScope: "not_started_wave"
        }),
        snapshot: expect.objectContaining({ field: "director", optional: true, supportedSchemaVersions: [1] })
      }
    });

    const mechanics = await callTool("describe_schema", { domain: "mechanics" }, {});
    expect(mechanics.mechanics).toMatchObject({
      implementedModuleIds: expect.arrayContaining(["director"]),
      modules: { director: expect.objectContaining({ authoring: expect.any(Object) }) }
    });
  });

  it("runs Director describe -> capabilities -> recipe -> preview -> guarded apply -> validate", async () => {
    const projectDir = fixture();
    const before = projectTree(projectDir);
    const capabilities = await callTool("get_capabilities", { projectDir, missionId: "tutorial_01" }, {});
    expect(capabilities.capabilities.director).toMatchObject({
      available: true,
      active: false,
      reason: "module_missing"
    });

    const recipes = await callTool("list_recipes", { collection: "mechanics" }, {});
    expect(recipes.recipes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "basic_adaptive_wave_director", moduleId: "director", moduleSchemaVersion: 1 })
    ]));
    const materialized = await callTool("get_recipe", {
      projectDir,
      collection: "mechanics",
      recipeId: "basic_adaptive_wave_director"
    }, {});
    expect(materialized.recipe.entity).toMatchObject({
      moduleId: "director",
      moduleSchemaVersion: 1,
      missionId: "tutorial_01",
      profileId: "basic_adaptive_wave_director",
      profile: {
        counterPool: expect.any(Object),
        threatBudget: { base: expect.any(Number), perWave: expect.any(Number) },
        fairness: {
          minimumWaveIndex: expect.any(Number),
          maxConsecutiveUses: expect.any(Number),
          maxAddedGroups: expect.any(Number),
          maxAddedEnemies: expect.any(Number)
        }
      }
    });
    const counters = Object.values(materialized.recipe.entity.profile.counterPool);
    expect(counters.length).toBeGreaterThan(0);
    expect(counters[0]).toMatchObject({
      conditions: expect.arrayContaining([expect.objectContaining({ metric: "damage_share" })]),
      groups: expect.arrayContaining([expect.objectContaining({ enemyId: expect.any(String), count: expect.any(Number) })])
    });
    expect(projectTree(projectDir)).toEqual(before);

    const request = { projectDir, ...materialized.recipe.entity, enabled: true };
    const preview = await callTool("preview_mechanics_module", request, {});
    expect(preview).toMatchObject({ ok: true, dryRun: true, written: false, revision: expect.any(String) });
    expect(projectTree(projectDir)).toEqual(before);
    const applied = await callTool("apply_mechanics_module", {
      ...request,
      ifRevision: preview.revision
    }, {});
    expect(applied).toMatchObject({
      ok: true,
      written: true,
      rolledBack: false,
      previousRevision: preview.revision,
      backup: { directory: expect.any(String) }
    });
    expect(await callTool("validate_project", { projectDir }, {})).toMatchObject({ ok: true, issues: [] });
    const enabled = await callTool("get_capabilities", { projectDir, missionId: "tutorial_01" }, {});
    expect(enabled.capabilities.director).toMatchObject({
      available: true,
      active: true,
      profileId: "basic_adaptive_wave_director",
      reason: "active"
    });
  }, 20_000);

  it("returns evidence-only auto-balance proposals and cannot commit project data", async () => {
    const projectDir = fixture();
    const before = projectTree(projectDir);
    const balance = JSON.parse(fs.readFileSync(path.join(projectDir, "content", "balance.json"), "utf8"));
    const towers = structuredClone(balance.towers);
    towers.arrow_tower.range = Math.max(1, towers.arrow_tower.range - 0.25);

    const result = await callTool("propose_balance_patches", {
      projectDir,
      missionId: "tutorial_01",
      candidates: [{ id: "arrow_range_minus_quarter", patch: { towers } }],
      seeds: ["r7-contract-seed"],
      strategyIds: ["baseline"],
      maxTicks: 60
    }, {});
    expect(result).toMatchObject({
      schemaVersion: 1,
      status: "completed",
      evaluatedRuns: expect.any(Number),
      proposals: expect.arrayContaining([
        expect.objectContaining({
          id: "arrow_range_minus_quarter",
          rank: expect.any(Number),
          patch: { towers: expect.any(Object) },
          evidence: expect.objectContaining({ runCount: expect.any(Number) })
        })
      ])
    });
    expect(result).not.toHaveProperty("written");
    expect(result).not.toHaveProperty("applied");
    expect(projectTree(projectDir)).toEqual(before);

    const descriptor = tool("propose_balance_patches");
    expect(descriptor).toMatchObject({ riskClass: "compute_only" });
    expect(descriptor.inputSchema.required).not.toContain("ifRevision");
    expect(JSON.stringify(descriptor)).toMatch(/evidence/i);
    expect(JSON.stringify(descriptor)).toMatch(/(?:writes no project files|no project files)/i);
    expect(JSON.stringify(descriptor)).not.toMatch(/auto(?:matic)?(?:ally)?[^.]{0,40}(?:commit|apply)/i);
  }, 20_000);

  it("previews a seeded procedural map through canonical compile, terrain, tileset, and deterministic headless checks without a project write", async () => {
    const projectDir = fixture();
    const before = projectTree(projectDir);
    const first = await callTool("preview_procedural_map", { projectDir, spec: MAP_SPEC }, {});
    const second = await callTool("preview_procedural_map", { projectDir, spec: structuredClone(MAP_SPEC) }, {});

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first).toMatchObject({
      schemaVersion: 1,
      ok: true,
      dryRun: true,
      written: false,
      revision: expect.any(String),
      source: { id: "generated_canyon", width: 14, height: 10, gridKind: "square" },
      evidence: {
        reachable: true,
        entranceCount: 2,
        loopCount: 1,
        buildableRatio: expect.any(Number),
        tilesetTerrainIds: ["buildable", "path", "water"],
        structuralSmoke: { ok: true },
        canonicalCompile: { ok: true, mapId: "generated_canyon" },
        terrainValidation: { ok: true, terrainIds: ["buildable", "path", "water"] },
        tilesetCoverage: { ok: true, mode: "legacy_fallback" },
        headlessSmoke: {
          contract: "deterministic_runtime_smoke_v1",
          ok: true,
          missionId: "tutorial_01",
          mapId: "generated_canyon",
          stateDigest: expect.any(String)
        }
      }
    });
    expect(first.evidence.buildableRatio).toBeGreaterThanOrEqual(MAP_SPEC.buildableRatio.min);
    expect(first.evidence.buildableRatio).toBeLessThanOrEqual(MAP_SPEC.buildableRatio.max);
    expect(projectTree(projectDir)).toEqual(before);
    expect(tool("preview_procedural_map")).toMatchObject({
      riskClass: "compute_only",
      sideEffect: expect.stringMatching(/(?:none|writes no project files)/i)
    });
  });

  it("commits exactly the previewed procedural map with a revision guard, backup, compile, and full validation", async () => {
    const projectDir = fixture();
    const preview = await callTool("preview_procedural_map", { projectDir, spec: MAP_SPEC }, {});
    const applied = await callTool("commit_procedural_map", {
      projectDir,
      spec: MAP_SPEC,
      ifRevision: preview.revision
    }, {});

    expect(applied).toMatchObject({
      schemaVersion: 1,
      ok: true,
      written: true,
      rolledBack: false,
      mapId: "generated_canyon",
      previousRevision: preview.revision,
      revision: expect.any(String),
      backup: {
        compiled: expect.stringMatching(/^\.towerforge\/mcp-backups\//)
      },
      validation: { ok: true, errorCount: 0 }
    });
    expect(applied.revision).not.toBe(preview.revision);
    expect(JSON.parse(fs.readFileSync(path.join(projectDir, "maps", "src", "generated_canyon.tmj"), "utf8"))).toEqual(preview.source);
    expect(JSON.parse(fs.readFileSync(path.join(projectDir, "maps", "compiled", "maps.json"), "utf8"))).toHaveProperty("generated_canyon");
    expect(await callTool("validate_project", { projectDir }, {})).toMatchObject({ ok: true });

    expect(tool("commit_procedural_map")).toMatchObject({
      riskClass: "write_local",
      inputSchema: expect.objectContaining({
        required: ["spec", "ifRevision"],
        additionalProperties: false
      }),
      sideEffect: expect.stringMatching(/revision.*backup.*(?:compile|validation).*rollback/i)
    });
  }, 20_000);

  it("fails closed when a generated terrain id is not declared by the current project", async () => {
    const projectDir = fixture();
    const preview = await callTool("preview_procedural_map", {
      projectDir,
      spec: {
        ...MAP_SPEC,
        terrain: { ...MAP_SPEC.terrain, blocked: "undeclared_generated_terrain" }
      }
    }, {});

    expect(preview).toMatchObject({
      ok: false,
      written: false,
      evidence: {
        canonicalCompile: { ok: true },
        terrainValidation: {
          ok: false,
          terrainIds: ["buildable", "path", "undeclared_generated_terrain"],
          issues: expect.arrayContaining([
            expect.objectContaining({ severity: "error", message: expect.stringMatching(/unknown terrain/i) })
          ])
        },
        headlessSmoke: {
          ok: false,
          reason: "candidate_validation_failed"
        }
      }
    });
    expect(fs.existsSync(path.join(projectDir, "maps", "src", "generated_canyon.tmj"))).toBe(false);
  }, 20_000);

  it("rejects a generated map id already owned by a differently named source", async () => {
    const projectDir = fixture();
    const tutorialSource = JSON.parse(fs.readFileSync(path.join(projectDir, "maps", "src", "tutorial_map.tmj"), "utf8"));
    fs.writeFileSync(path.join(projectDir, "maps", "src", "duplicate_id.tmj"), `${JSON.stringify({
      ...tutorialSource,
      id: MAP_SPEC.mapId,
      properties: (tutorialSource.properties ?? []).map((property) => (
        property?.name === "id" ? { ...property, value: MAP_SPEC.mapId } : property
      ))
    }, null, 2)}\n`);

    const preview = await callTool("preview_procedural_map", { projectDir, spec: MAP_SPEC }, {});
    expect(preview).toMatchObject({
      ok: false,
      written: false,
      evidence: {
        canonicalCompile: {
          ok: false,
          issues: expect.arrayContaining([
            expect.objectContaining({ message: expect.stringMatching(/already owned by duplicate_id\.tmj/i) })
          ])
        },
        headlessSmoke: { ok: false, reason: "candidate_validation_failed" }
      }
    });
  }, 20_000);

  it("rejects a stale procedural-map revision without touching the generated source or compiled catalog", async () => {
    const projectDir = fixture();
    const preview = await callTool("preview_procedural_map", { projectDir, spec: MAP_SPEC }, {});
    const tutorialSource = JSON.parse(fs.readFileSync(path.join(projectDir, "maps", "src", "tutorial_map.tmj"), "utf8"));
    fs.writeFileSync(path.join(projectDir, "maps", "src", "revision_probe.tmj"), `${JSON.stringify({ ...tutorialSource, id: "revision_probe" }, null, 2)}\n`);
    const compiledBefore = fs.readFileSync(path.join(projectDir, "maps", "compiled", "maps.json"), "utf8");

    const stale = await callTool("commit_procedural_map", {
      projectDir,
      spec: MAP_SPEC,
      ifRevision: preview.revision
    }, {});

    expect(stale).toMatchObject({
      ok: false,
      conflict: true,
      written: false,
      expectedRevision: preview.revision,
      actualRevision: expect.any(String)
    });
    expect(stale.actualRevision).not.toBe(preview.revision);
    expect(fs.existsSync(path.join(projectDir, "maps", "src", "generated_canyon.tmj"))).toBe(false);
    expect(fs.readFileSync(path.join(projectDir, "maps", "compiled", "maps.json"), "utf8")).toBe(compiledBefore);
  }, 20_000);

  it("rolls back both generated source and compiled maps when the guarded transaction fails", async () => {
    const projectDir = fixture();
    const preview = await callTool("preview_procedural_map", { projectDir, spec: MAP_SPEC }, {});
    const sourcePath = path.join(projectDir, "maps", "src", "generated_canyon.tmj");
    const compiledPath = path.join(projectDir, "maps", "compiled", "maps.json");
    const compiledBefore = fs.readFileSync(compiledPath, "utf8");
    const renameSync = fs.renameSync;
    let injected = false;
    fs.renameSync = (source, destination) => {
      if (!injected && path.resolve(String(destination)) === path.resolve(compiledPath)
        && String(source).includes(".tmp.")) {
        injected = true;
        throw new Error("injected procedural compiled write failure");
      }
      return renameSync(source, destination);
    };
    try {
      const failed = await callTool("commit_procedural_map", {
        projectDir,
        spec: MAP_SPEC,
        ifRevision: preview.revision
      }, {});
      expect(failed).toMatchObject({
        ok: false,
        written: false,
        rolledBack: true,
        error: expect.stringMatching(/injected procedural compiled write failure/i)
      });
    } finally {
      fs.renameSync = renameSync;
    }
    expect(injected).toBe(true);
    expect(fs.existsSync(sourcePath)).toBe(false);
    expect(fs.readFileSync(compiledPath, "utf8")).toBe(compiledBefore);
  }, 20_000);

  it("advertises provider-neutral staged asset tools with narrow metadata and guarded commit risk", () => {
    const stage = tool("stage_generated_asset");
    const inspect = tool("inspect_staged_asset");
    const commit = tool("commit_staged_asset");
    const discard = tool("discard_staged_asset");

    expect(stage).toMatchObject({
      riskClass: "write_local",
      inputSchema: expect.objectContaining({ additionalProperties: false })
    });
    expect(inspect).toMatchObject({ riskClass: "read_only" });
    expect(discard).toMatchObject({ riskClass: "write_local" });
    expect(commit).toMatchObject({
      riskClass: "write_local",
      inputSchema: expect.objectContaining({
        required: expect.arrayContaining(["handle", "assetId", "kind", "ifRevision"]),
        additionalProperties: false
      })
    });

    const publicContract = JSON.stringify({ stage, inspect, commit, discard });
    expect(publicContract).toMatch(/opaque[^.]{0,80}(?:handle|staging)|(?:handle|staging)[^.]{0,80}opaque/i);
    expect(publicContract).toMatch(/MIME|signature/i);
    expect(publicContract).toMatch(/size/i);
    expect(publicContract).toMatch(/license/i);
    expect(publicContract).toMatch(/provenance/i);
    expect(publicContract).toMatch(/revision[\s\S]*validation[\s\S]*(?:backup[\s\S]*rollback|rollback[\s\S]*backup)/i);
    expect(publicContract).not.toMatch(/api[_ -]?key|secret|credential/i);
  });

  it("stages, revalidates, revision-guards, and commits generated asset provenance without exposing payload paths", async () => {
    const projectDir = fixture();
    const visualsPath = path.join(projectDir, "content", "visuals.json");
    const originalVisuals = fs.readFileSync(visualsPath, "utf8");
    const summary = await callTool("get_project_summary", { projectDir }, {});
    const staged = await callTool("stage_generated_asset", {
      projectDir,
      dataBase64: ONE_PIXEL_PNG,
      declaredMimeType: "image/png",
      fileName: "generated-tower.png",
      license: { id: "CC0-1.0", attribution: null },
      provenance: {
        generator: "agent-runtime",
        provider: "contract-provider",
        model: "contract-image-model",
        generatedAt: "2026-07-28T00:00:00.000Z"
      }
    }, {});
    expect(staged).toMatchObject({
      schemaVersion: 1,
      handle: expect.stringMatching(/^staged_[A-Za-z0-9_-]{16,}$/),
      mimeType: "image/png",
      readyForPreview: true
    });
    expect(staged).not.toHaveProperty("path");
    expect(staged).not.toHaveProperty("bytes");
    expect(staged).not.toHaveProperty("prompt");
    expect(fs.readFileSync(visualsPath, "utf8")).toBe(originalVisuals);

    const inspected = await callTool("inspect_staged_asset", {
      projectDir,
      handle: staged.handle
    }, {});
    expect(inspected).toMatchObject({
      signatureValid: true,
      license: { id: "CC0-1.0", attribution: null },
      provenance: {
        generator: "agent-runtime",
        provider: "contract-provider",
        model: "contract-image-model"
      }
    });
    expect(inspected).not.toHaveProperty("path");
    expect(inspected).not.toHaveProperty("bytes");

    const stale = await callTool("commit_staged_asset", {
      projectDir,
      handle: staged.handle,
      assetId: "generated_tower",
      kind: "sprite",
      ifRevision: "stale-revision"
    }, {});
    expect(stale).toMatchObject({ ok: false, written: false, conflict: true });
    expect(fs.readFileSync(visualsPath, "utf8")).toBe(originalVisuals);

    const committed = await callTool("commit_staged_asset", {
      projectDir,
      handle: staged.handle,
      assetId: "generated_tower",
      kind: "sprite",
      ifRevision: summary.revisions.visuals
    }, {});
    expect(committed).toMatchObject({
      ok: true,
      written: true,
      rolledBack: false,
      stagingDiscarded: true,
      asset: { id: "generated_tower", kind: "sprite", path: "assets/generated-tower.png" },
      backup: { visuals: expect.any(String), asset: null }
    });
    const visuals = JSON.parse(fs.readFileSync(visualsPath, "utf8"));
    expect(visuals.sprites.generated_tower).toMatchObject({
      src: "assets/generated-tower.png",
      generation: {
        schemaVersion: 1,
        license: { id: "CC0-1.0", attribution: null },
        provenance: {
          generator: "agent-runtime",
          provider: "contract-provider",
          model: "contract-image-model"
        }
      }
    });
    expect(fs.existsSync(path.join(projectDir, "assets", "generated-tower.png"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, ".towerforge", "generated-assets", staged.handle))).toBe(false);
    expect(await callTool("validate_project", { projectDir }, {})).toMatchObject({ ok: true, issues: [] });

    await expect(callTool("stage_generated_asset", {
      projectDir,
      dataBase64: "not-base64!",
      declaredMimeType: "image/png",
      fileName: "bad.png",
      license: { id: "CC0-1.0", attribution: null },
      provenance: {
        generator: "agent-runtime",
        provider: "contract-provider",
        model: "contract-image-model",
        generatedAt: "2026-07-28T00:00:00.000Z"
      }
    }, {})).rejects.toThrow(/base64|signature|MIME/i);
  }, 20_000);

  it("commits the exact bytes inspected before an asynchronous staging mutation", async () => {
    const projectDir = fixture();
    const summary = await callTool("get_project_summary", { projectDir }, {});
    const staged = await callTool("stage_generated_asset", {
      projectDir,
      dataBase64: ONE_PIXEL_PNG,
      declaredMimeType: "image/png",
      fileName: "stable-generated.png",
      license: { id: "CC0-1.0", attribution: null },
      provenance: {
        generator: "agent-runtime",
        provider: "contract-provider",
        model: "contract-image-model",
        generatedAt: "2026-07-28T00:00:00.000Z"
      }
    }, {});

    const commit = callTool("commit_staged_asset", {
      projectDir,
      handle: staged.handle,
      assetId: "stable_generated",
      kind: "sprite",
      ifRevision: summary.revisions.visuals
    }, {});
    const stagedPayload = path.join(projectDir, ".towerforge", "generated-assets", staged.handle, "payload.bin");
    const tampered = Buffer.from(ONE_PIXEL_PNG, "base64");
    tampered[tampered.length - 1] ^= 0xff;
    fs.writeFileSync(stagedPayload, tampered);

    const result = await commit;
    expect(result).toMatchObject({ ok: true, written: true });
    expect(fs.readFileSync(path.join(projectDir, "assets", "stable-generated.png"))).toEqual(
      Buffer.from(ONE_PIXEL_PNG, "base64")
    );
  }, 20_000);

  it("never binds a committed asset back into private staging state", async () => {
    const projectDir = fixture();
    const staged = await callTool("stage_generated_asset", {
      projectDir,
      dataBase64: ONE_PIXEL_PNG,
      declaredMimeType: "image/png",
      fileName: "payload.bin",
      license: { id: "CC0-1.0", attribution: null },
      provenance: {
        generator: "agent-runtime",
        provider: "contract-provider",
        model: "contract-image-model",
        generatedAt: "2026-07-28T00:00:00.000Z"
      }
    }, {});
    const visualsPath = path.join(projectDir, "content", "visuals.json");
    const visuals = JSON.parse(fs.readFileSync(visualsPath, "utf8"));
    visuals.assetsRoot = `.towerforge/generated-assets/${staged.handle}`;
    fs.writeFileSync(visualsPath, `${JSON.stringify(visuals, null, 2)}\n`);
    const revision = (await callTool("get_project_summary", { projectDir }, {})).revisions.visuals;

    await expect(callTool("commit_staged_asset", {
      projectDir,
      handle: staged.handle,
      assetId: "staging_alias",
      kind: "sprite",
      targetPath: "payload.bin",
      ifRevision: revision
    }, {})).rejects.toThrow(/private|staging|towerforge|destination/i);
    expect(fs.existsSync(path.join(projectDir, ".towerforge", "generated-assets", staged.handle))).toBe(true);
  }, 20_000);
});
