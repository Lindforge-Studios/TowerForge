import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readRawProjectFiles } from "../cli/lib/project-loader.mjs";
import { migrateProjectFiles, writeMigratedProjectFiles } from "../cli/lib/project-migrations.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const rootPackage = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const PORT = 5197;
const BASE = `http://127.0.0.1:${PORT}`;

let projectDir;
let serverProcess;

beforeAll(async () => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-server-test-"));
  fs.cpSync(path.join(repoRoot, "examples", "starter.tdproj"), projectDir, { recursive: true });
  serverProcess = spawn(process.execPath, [path.join(repoRoot, "packages", "studio", "server.mjs"), "--project", projectDir], {
    cwd: repoRoot,
    env: { ...process.env, PORT: String(PORT) },
    stdio: "pipe"
  });
  await waitForHttp(`${BASE}/api/project`);
}, 30_000);

afterAll(async () => {
  if (serverProcess) {
    serverProcess.kill();
    await new Promise((resolve) => serverProcess.once("exit", resolve));
  }
  if (projectDir) fs.rmSync(projectDir, { recursive: true, force: true });
});

// Regression coverage for the Origin/Host guard that closes the drive-by-localhost /
// DNS-rebinding hole: the studio server writes project files on POST and must reject any
// request whose Host/Origin doesn't name this exact server, with no wildcard CORS header.
describe("studio server origin/host guard", () => {
  it("serves a same-origin request normally", async () => {
    const res = await fetch(`${BASE}/api/project`);
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("returns normalized mechanics for the unauthored starter without materializing or upgrading it", async () => {
    const manifestPath = path.join(projectDir, "project.json");
    const mechanicsPath = path.join(projectDir, "content", "mechanics.json");
    const authoredSchemaVersion = JSON.parse(fs.readFileSync(manifestPath, "utf8")).schemaVersion;

    const res = await fetch(`${BASE}/api/project`);
    const project = await res.json();

    expect(res.status).toBe(200);
    expect(project.mechanics).toEqual({ schemaVersion: 1, modules: {} });
    expect(project.mechanicsAuthored).toBe(false);
    expect(project.manifest.schemaVersion).toBeLessThan(3);
    expect(fs.existsSync(mechanicsPath)).toBe(false);
    expect(JSON.parse(fs.readFileSync(manifestPath, "utf8")).schemaVersion).toBe(authoredSchemaVersion);
  });

  it("runs revision-bound Persona QA through the read-only Studio facade and rejects stale evidence", async () => {
    const project = await (await fetch(`${BASE}/api/project`)).json();
    const request = {
      contentHash: project.contentHash,
      schemaVersion: 1,
      missionIds: ["tutorial_01"],
      seeds: ["studio-route"],
      personaIds: ["aggressive_rush"],
      simSeconds: 0.2,
      tickStep: 0.2
    };
    const response = await fetch(`${BASE}/api/persona-qa/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request)
    });
    const report = await response.json();
    expect(response.status).toBe(200);
    expect(report).toMatchObject({
      schemaVersion: 1,
      status: "completed",
      contentHash: project.contentHash,
      missionIds: ["tutorial_01"],
      seeds: ["studio-route"],
      personaIds: ["aggressive_rush"],
      completedRuns: 1
    });

    const stale = await fetch(`${BASE}/api/persona-qa/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...request, contentHash: "stale-revision" })
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "revision_conflict" });
  }, 30_000);

  it("turns a stale passive balance request into an inert success instead of a browser-visible 500", async () => {
    const project = await (await fetch(`${BASE}/api/project`)).json();
    const manifestPath = path.join(projectDir, "project.json");
    const original = fs.readFileSync(manifestPath);
    const manifest = JSON.parse(original.toString("utf8"));
    try {
      fs.writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, name: `${manifest.name} external edit` }, null, 2)}\n`);
      const response = await fetch(`${BASE}/api/balance?ifRevision=${project.contentHash}`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ stale: true });
    } finally {
      fs.writeFileSync(manifestPath, original);
    }
  });

  it("keeps quest generation preview inactive until the mission explicitly selects quests", async () => {
    const project = await (await fetch(`${BASE}/api/project`)).json();
    const response = await fetch(`${BASE}/api/quests/preview-generation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contentHash: project.contentHash, missionId: "tutorial_01", seed: "studio-route" })
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "module_inactive" });
  });

  it("lists parameterized terraforming recipes as inert metadata without breaking existing mechanics recipes", async () => {
    const response = await fetch(`${BASE}/api/recipes?collection=mechanics`);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.collection).toBe("mechanics");
    expect(payload.recipes.find((recipe) => recipe.id === "basic_regenerating_shields"))
      .toMatchObject({ entity: { moduleId: "combat", moduleSchemaVersion: 1 } });

    const terraforming = payload.recipes.filter((recipe) => recipe.moduleId === "terraforming");
    expect(terraforming.map((recipe) => recipe.id)).toEqual([
      "tagged_flood",
      "tagged_moat",
      "tagged_destructible_bridge"
    ]);
    for (const recipe of terraforming) {
      expect(recipe.parameterSchema).toMatchObject({
        type: "object",
        required: ["sourceTerrainTag", "destinationTerrainId"],
        additionalProperties: false
      });
      expect(recipe).not.toHaveProperty("entity");
      expect(recipe).not.toHaveProperty("towerScriptSnippet");
    }
  });

  it("keeps mechanics absent and the authored project schema unchanged on an ordinary Studio save", async () => {
    const manifestPath = path.join(projectDir, "project.json");
    const mechanicsPath = path.join(projectDir, "content", "mechanics.json");
    const authoredSchemaVersion = JSON.parse(fs.readFileSync(manifestPath, "utf8")).schemaVersion;
    const project = await (await fetch(`${BASE}/api/project`)).json();

    const res = await fetch(`${BASE}/api/project/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ordinaryStudioSaveBody(project))
    });

    expect(res.status).toBe(200);
    expect(fs.existsSync(mechanicsPath)).toBe(false);
    expect(JSON.parse(fs.readFileSync(manifestPath, "utf8")).schemaVersion).toBe(authoredSchemaVersion);
  });

  it("rejects mechanics preview/apply on a raw-v1 project with migration guidance and no writes", async () => {
    const manifestPath = path.join(projectDir, "project.json");
    const balancePath = path.join(projectDir, "content", "balance.json");
    const mechanicsPath = path.join(projectDir, "content", "mechanics.json");
    const beforeManifest = fs.readFileSync(manifestPath);
    const beforeBalance = fs.readFileSync(balancePath);
    const capabilities = await (await fetch(`${BASE}/api/mechanics/capabilities?missionId=tutorial_01`)).json();
    const request = {
      moduleId: "combat",
      missionId: "tutorial_01",
      profileId: "raw_v1_forbidden",
      profile: { shields: { enemies: { basic_grunt: { capacity: 10 } }, towers: {} } }
    };

    for (const [endpoint, extra] of [
      ["preview", {}],
      ["apply", { ifRevision: capabilities.revision }]
    ]) {
      const response = await fetch(`${BASE}/api/mechanics/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...request, ...extra })
      });
      expect([409, 422]).toContain(response.status);
      expect(await response.json()).toMatchObject({
        code: "project_migration_required",
        guidance: expect.stringMatching(/migrate|schema.*v?2/i)
      });
      expect(fs.readFileSync(manifestPath)).toEqual(beforeManifest);
      expect(fs.readFileSync(balancePath)).toEqual(beforeBalance);
      expect(fs.existsSync(mechanicsPath)).toBe(false);
    }
  });

  it("previews, enables, saves, disables, re-enables, and reloads combat through the guarded Hub API", async () => {
    const manifestPath = path.join(projectDir, "project.json");
    const balancePath = path.join(projectDir, "content", "balance.json");
    const mechanicsPath = path.join(projectDir, "content", "mechanics.json");
    const originalManifest = fs.readFileSync(manifestPath);
    const originalBalance = fs.readFileSync(balancePath);
    const request = {
      moduleId: "combat",
      missionId: "tutorial_01",
      profileId: "studio_shields",
      enabled: true,
      profile: {
        shields: {
          enemies: {
            basic_grunt: {
              capacity: 12,
              regeneration: { ratePerUnit: 1, delayAfterDamage: 2 }
            }
          },
          towers: {}
        }
      }
    };

    try {
      const migrated = migrateProjectFiles(readRawProjectFiles(projectDir));
      writeMigratedProjectFiles(projectDir, migrated.files);
      expect(JSON.parse(fs.readFileSync(manifestPath, "utf8")).schemaVersion).toBe(2);

      const capabilitiesResponse = await fetch(`${BASE}/api/mechanics/capabilities?missionId=tutorial_01`);
      const capabilities = await capabilitiesResponse.json();
      expect(capabilitiesResponse.status).toBe(200);
      expect(capabilities.capabilities.combat).toMatchObject({
        available: true, active: false, reason: "module_missing"
      });
      expect(typeof capabilities.revision).toBe("string");
      expect(fs.existsSync(mechanicsPath)).toBe(false);

      const previewResponse = await fetch(`${BASE}/api/mechanics/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request)
      });
      const preview = await previewResponse.json();
      expect(previewResponse.status).toBe(200);
      expect(preview).toMatchObject({
        ok: true,
        dryRun: true,
        migration: { required: true, from: 2, to: 3 },
        validation: { ok: true, issues: [] }
      });
      expect(fs.existsSync(mechanicsPath)).toBe(false);

      const unguardedResponse = await fetch(`${BASE}/api/mechanics/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request)
      });
      expect(unguardedResponse.status).toBe(428);
      expect(await unguardedResponse.json()).toMatchObject({ code: "revision_required" });

      const applyResponse = await fetch(`${BASE}/api/mechanics/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...request, ifRevision: preview.revision })
      });
      const applied = await applyResponse.json();
      expect(applyResponse.status).toBe(200);
      expect(applied).toMatchObject({ ok: true, previousRevision: preview.revision });

      let reloaded = await (await fetch(`${BASE}/api/project`)).json();
      expect(reloaded.mechanicsAuthored).toBe(true);
      expect(reloaded.manifest.schemaVersion).toBe(3);
      expect(reloaded.mechanics.modules.combat.enabled).toBe(true);
      expect(reloaded.missions.tutorial_01.mechanics.profiles.combat).toBe("studio_shields");

      const saveResponse = await fetch(`${BASE}/api/project/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ordinaryStudioSaveBody(reloaded))
      });
      expect(saveResponse.status).toBe(200);
      expect(JSON.parse(fs.readFileSync(mechanicsPath, "utf8")).modules.combat.profiles.studio_shields)
        .toEqual(request.profile);

      const disablePreview = await postJson("/api/mechanics/preview", {
        moduleId: "combat", missionId: "tutorial_01", enabled: false
      });
      const disabled = await postJson("/api/mechanics/apply", {
        moduleId: "combat", missionId: "tutorial_01", enabled: false,
        ifRevision: disablePreview.body.revision
      });
      expect(disabled.response.status).toBe(200);
      reloaded = await (await fetch(`${BASE}/api/project`)).json();
      expect(reloaded.mechanics.modules.combat.enabled).toBe(false);
      expect(reloaded.mechanics.modules.combat.profiles.studio_shields).toEqual(request.profile);
      expect(reloaded.missions.tutorial_01.mechanics.profiles.combat).toBe("studio_shields");

      const enablePreview = await postJson("/api/mechanics/preview", {
        moduleId: "combat", missionId: "tutorial_01", enabled: true
      });
      const reenabled = await postJson("/api/mechanics/apply", {
        moduleId: "combat", missionId: "tutorial_01", enabled: true,
        ifRevision: enablePreview.body.revision
      });
      expect(reenabled.response.status).toBe(200);
      reloaded = await (await fetch(`${BASE}/api/project`)).json();
      expect(reloaded.mechanics.modules.combat.enabled).toBe(true);
      expect(reloaded.mechanics.modules.combat.profiles.studio_shields).toEqual(request.profile);
    } finally {
      fs.writeFileSync(manifestPath, originalManifest);
      fs.writeFileSync(balancePath, originalBalance);
      fs.rmSync(mechanicsPath, { force: true });
    }
  });

  it("previews, enables, edits, reloads, disables, and re-enables quests through the guarded Hub API", async () => {
    const manifestPath = path.join(projectDir, "project.json");
    const balancePath = path.join(projectDir, "content", "balance.json");
    const mechanicsPath = path.join(projectDir, "content", "mechanics.json");
    const originalManifest = fs.readFileSync(manifestPath);
    const originalBalance = fs.readFileSync(balancePath);
    const profile = {
      selectionCount: 1,
      definitions: {
        arrow_finish: {
          label: "Arrow finishers",
          weight: 1,
          objective: {
            kind: "kill_with_source",
            count: 1,
            source: { kind: "tower", id: "arrow_tower" }
          }
        }
      }
    };
    const request = {
      moduleId: "quests",
      moduleSchemaVersion: 1,
      missionId: "tutorial_01",
      profileId: "studio_quests",
      enabled: true,
      profile
    };

    try {
      writeMigratedProjectFiles(projectDir, migrateProjectFiles(readRawProjectFiles(projectDir)).files);

      const preview = await postJson("/api/mechanics/preview", request);
      expect(preview.response.status).toBe(200);
      expect(preview.body).toMatchObject({ ok: true, dryRun: true, validation: { ok: true, issues: [] } });
      expect(fs.existsSync(mechanicsPath)).toBe(false);

      const applied = await postJson("/api/mechanics/apply", {
        ...request,
        ifRevision: preview.body.revision
      });
      expect(applied.response.status).toBe(200);
      let reloaded = await (await fetch(`${BASE}/api/project`)).json();
      expect(reloaded.mechanics.modules.quests).toMatchObject({ schemaVersion: 1, enabled: true });
      expect(reloaded.mechanics.modules.quests.profiles.studio_quests).toEqual(profile);
      expect(reloaded.missions.tutorial_01.mechanics.profiles.quests).toBe("studio_quests");

      const generation = await postJson("/api/quests/preview-generation", {
        contentHash: reloaded.contentHash,
        missionId: "tutorial_01",
        seed: "studio-lifecycle"
      });
      expect(generation.response.status).toBe(200);
      expect(generation.body).toMatchObject({
        dryRun: true,
        written: false,
        profileId: "studio_quests",
        contentHash: reloaded.contentHash,
        quests: [{
          questId: "arrow_finish",
          definition: { objective: { kind: "kill_with_source", count: 1 } }
        }]
      });

      const editedProfile = structuredClone(profile);
      editedProfile.definitions.arrow_finish.objective.count = 2;
      const editRequest = { ...request, profile: editedProfile };
      const editPreview = await postJson("/api/mechanics/preview", editRequest);
      expect(editPreview.response.status).toBe(200);
      const edited = await postJson("/api/mechanics/apply", {
        ...editRequest,
        ifRevision: editPreview.body.revision
      });
      expect(edited.response.status).toBe(200);
      reloaded = await (await fetch(`${BASE}/api/project`)).json();
      expect(reloaded.mechanics.modules.quests.profiles.studio_quests).toEqual(editedProfile);

      const disablePreview = await postJson("/api/mechanics/preview", {
        moduleId: "quests", moduleSchemaVersion: 1, missionId: "tutorial_01", enabled: false
      });
      const disabled = await postJson("/api/mechanics/apply", {
        moduleId: "quests", moduleSchemaVersion: 1, missionId: "tutorial_01", enabled: false,
        ifRevision: disablePreview.body.revision
      });
      expect(disabled.response.status).toBe(200);
      reloaded = await (await fetch(`${BASE}/api/project`)).json();
      expect(reloaded.mechanics.modules.quests.enabled).toBe(false);
      expect(reloaded.mechanics.modules.quests.profiles.studio_quests).toEqual(editedProfile);
      const inactiveGeneration = await postJson("/api/quests/preview-generation", {
        contentHash: reloaded.contentHash,
        missionId: "tutorial_01",
        seed: "studio-lifecycle"
      });
      expect(inactiveGeneration.response.status).toBe(422);
      expect(inactiveGeneration.body).toMatchObject({ code: "module_inactive" });

      const enablePreview = await postJson("/api/mechanics/preview", {
        moduleId: "quests", moduleSchemaVersion: 1, missionId: "tutorial_01", enabled: true
      });
      const reenabled = await postJson("/api/mechanics/apply", {
        moduleId: "quests", moduleSchemaVersion: 1, missionId: "tutorial_01", enabled: true,
        ifRevision: enablePreview.body.revision
      });
      expect(reenabled.response.status).toBe(200);
      reloaded = await (await fetch(`${BASE}/api/project`)).json();
      expect(reloaded.mechanics.modules.quests.enabled).toBe(true);
      expect(reloaded.mechanics.modules.quests.profiles.studio_quests).toEqual(editedProfile);
      const regenerated = await postJson("/api/quests/preview-generation", {
        contentHash: reloaded.contentHash,
        missionId: "tutorial_01",
        seed: "studio-lifecycle"
      });
      expect(regenerated.response.status).toBe(200);
      expect(regenerated.body.quests).toMatchObject([{
        questId: "arrow_finish",
        definition: { objective: { kind: "kill_with_source", count: 2 } }
      }]);
    } finally {
      fs.writeFileSync(manifestPath, originalManifest);
      fs.writeFileSync(balancePath, originalBalance);
      fs.rmSync(mechanicsPath, { force: true });
    }
  }, 30_000);

  it("serves public application metadata from the root package", async () => {
    const res = await fetch(`${BASE}/api/app-info`);
    const info = await res.json();
    expect(res.status).toBe(200);
    expect(info).toMatchObject({
      name: "TowerForge Studio",
      version: rootPackage.version,
      studioName: "Lindforge Studios",
      siteUrl: "https://lindforge.com",
      telegramUrl: "https://t.me/lindforge"
    });
    expect(info.sourceUrl).toBe("https://github.com/Lindforge-Studios/TowerForge");
  });

  it("allows a same-origin request that also sends a matching Origin header", async () => {
    const res = await fetch(`${BASE}/api/project`, { headers: { Origin: `http://127.0.0.1:${PORT}` } });
    expect(res.status).toBe(200);
  });

  it("rejects a forged Host header (DNS-rebinding simulation)", async () => {
    // fetch() refuses to let user code override the forbidden "Host" header, so a raw
    // http.request is needed to actually simulate a DNS-rebound request here.
    const { status, body } = await rawGet("/api/project", { Host: "evil.example.com" });
    expect(status).toBe(403);
    expect(JSON.parse(body).error).toMatch(/forbidden/i);
  });

  it("rejects a cross-origin Origin header even with a legitimate Host (drive-by simulation)", async () => {
    const res = await fetch(`${BASE}/api/project/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://evil.example.com" },
      body: JSON.stringify({})
    });
    expect(res.status).toBe(403);
  });

  it("never issues a wildcard Access-Control-Allow-Origin header", async () => {
    const res = await fetch(`${BASE}/api/project`);
    expect(res.headers.get("access-control-allow-origin")).not.toBe("*");
  });

  it("serves project assets with nosniff while rejecting non-assets, sensitive files, and symlink escapes", async () => {
    const assetPath = "assets/backgrounds/frontier-before-battle.png";
    const image = await fetch(`${BASE}/project-file/${assetPath}`);
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/png");
    expect(image.headers.get("x-content-type-options")).toBe("nosniff");

    fs.writeFileSync(path.join(projectDir, "assets", ".env"), "TOKEN=secret\n");
    fs.writeFileSync(path.join(projectDir, "assets", ".env.staging"), "TOKEN=secret\n");
    fs.mkdirSync(path.join(projectDir, "assets", ".ssh"));
    fs.writeFileSync(path.join(projectDir, "assets", ".ssh", "id_rsa.mp3"), "ID3secret");
    fs.writeFileSync(path.join(projectDir, "assets", "evil.html"), "<script>alert(1)</script>");
    fs.writeFileSync(path.join(projectDir, "assets", "evil.js"), "alert(1)");
    fs.writeFileSync(path.join(projectDir, "assets", "unsafe.svg"), "<svg><script>alert(1)</script></svg>");
    fs.writeFileSync(path.join(projectDir, "assets", "disguised.png"), "<script>alert(1)</script>");
    const outside = path.join(path.dirname(projectDir), `${path.basename(projectDir)}-outside.png`);
    const link = path.join(projectDir, "assets", "linked.png");
    fs.writeFileSync(outside, "outside");
    fs.symlinkSync(outside, link);
    try {
      expect((await fetch(`${BASE}/project-file/content/balance.json`)).status).toBe(404);
      expect((await fetch(`${BASE}/project-file/assets/.env`)).status).toBe(404);
      expect((await fetch(`${BASE}/project-file/assets/.env.staging`)).status).toBe(404);
      expect((await fetch(`${BASE}/project-file/assets/.ssh/id_rsa.mp3`)).status).toBe(404);
      expect((await fetch(`${BASE}/project-file/assets/evil.html`)).status).toBe(404);
      expect((await fetch(`${BASE}/project-file/assets/evil.js`)).status).toBe(404);
      const svg = await fetch(`${BASE}/project-file/assets/unsafe.svg`);
      expect(svg.status).toBe(200);
      expect(svg.headers.get("content-type")).toBe("image/svg+xml");
      expect(svg.headers.get("content-security-policy")).toContain("sandbox");
      expect(svg.headers.get("content-security-policy")).toContain("default-src 'none'");
      expect((await fetch(`${BASE}/project-file/assets/disguised.png`)).status).toBe(404);
      expect((await fetch(`${BASE}/project-file/assets/linked.png`)).status).toBe(404);
      expect((await fetch(`${BASE}/project-file/%2e%2e/project.json`)).status).toBe(404);
    } finally {
      fs.rmSync(link, { force: true });
      fs.rmSync(outside, { force: true });
      fs.rmSync(path.join(projectDir, "assets", ".env"), { force: true });
      fs.rmSync(path.join(projectDir, "assets", ".env.staging"), { force: true });
      fs.rmSync(path.join(projectDir, "assets", ".ssh"), { recursive: true, force: true });
      fs.rmSync(path.join(projectDir, "assets", "evil.html"), { force: true });
      fs.rmSync(path.join(projectDir, "assets", "evil.js"), { force: true });
      fs.rmSync(path.join(projectDir, "assets", "unsafe.svg"), { force: true });
      fs.rmSync(path.join(projectDir, "assets", "disguised.png"), { force: true });
    }
  });

  it("previews unsaved map sources without replacing compiled maps on disk", async () => {
    const project = await (await fetch(`${BASE}/api/project`)).json();
    const sources = structuredClone(project.mapSources);
    const source = sources["tutorial_map.tmj"];
    const nextPath = [{ q: 6, r: 0 }, { q: 6, r: 1 }, { q: 6, r: 2 }];
    source.properties.find((prop) => prop.name === "pathCenterline").value = JSON.stringify(nextPath);
    const compiledPath = path.join(projectDir, "maps", "compiled", "maps.json");
    const before = fs.readFileSync(compiledPath, "utf8");

    const response = await fetch(`${BASE}/api/maps/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mapSources: sources })
    });
    const preview = await response.json();

    expect(response.status).toBe(200);
    expect(preview.maps.tutorial_map.pathCenterline).toEqual(nextPath);
    expect(preview.maps.tutorial_map.pathRoutes[0].pathCenterline).toEqual(nextPath);
    expect(fs.readFileSync(compiledPath, "utf8")).toBe(before);
  });

  it("previews and atomically imports a browser-selected tileset PNG", async () => {
    const imageBytes = fs.readFileSync(path.join(repoRoot, "packages", "cli", "theme-packs", "verdant-frontier", "assets", "tiles-square.png"));
    const descriptor = JSON.stringify({
      type: "tileset",
      name: "uploaded_square",
      image: "tilesets/uploaded-square.png",
      tilewidth: 64,
      tileheight: 64,
      tilecount: 1,
      columns: 1,
      properties: [{ name: "towerforge.terrainId", value: "buildable" }]
    });
    const request = {
      descriptor,
      sourceName: "uploaded-square.tsj",
      topology: "square",
      image: { name: "uploaded-square.png", mimeType: "image/png", data: imageBytes.toString("base64") }
    };
    const previewResponse = await fetch(`${BASE}/api/tilesets/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request)
    });
    const preview = await previewResponse.json();
    expect(previewResponse.status).toBe(200);
    expect(preview.image).toMatchObject({ uploaded: true, width: 1024, height: 384 });

    const applyResponse = await fetch(`${BASE}/api/tilesets/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...request, ifRevision: preview.revision })
    });
    const applied = await applyResponse.json();
    expect(applyResponse.status).toBe(200);
    expect(applied).toMatchObject({ ok: true, tileSetId: "uploaded_square", imagePath: "assets/tilesets/uploaded-square.png" });
    expect(fs.readFileSync(path.join(projectDir, "assets", "tilesets", "uploaded-square.png"))).toEqual(imageBytes);
    const visuals = JSON.parse(fs.readFileSync(path.join(projectDir, "content", "visuals.json"), "utf8"));
    expect(visuals.tileSets.uploaded_square.materials.buildable.signatures.random).toHaveLength(1);
  });
});

function ordinaryStudioSaveBody(project) {
  return {
    contentHash: project.contentHash,
    enemies: project.enemies,
    towers: project.towers,
    waveSets: project.waveSets,
    missions: project.missions,
    abilities: project.abilities,
    constants: project.constants,
    currencies: project.currencies,
    defaultMissionId: project.defaultMissionId,
    defaultDifficultyId: project.defaultDifficultyId,
    difficulties: project.difficulties,
    metaProgression: project.metaProgression,
    terrainTypes: project.terrainTypes,
    worldMap: project.worldMap,
    visuals: project.visuals,
    storyComics: project.storyComics,
    battleBackgrounds: project.battleBackgrounds,
    mapSources: project.mapSources,
    manifest: project.manifest,
    buildTargets: project.buildTargets
  };
}

async function postJson(pathname, body) {
  const response = await fetch(`${BASE}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return { response, body: await response.json() };
}

function rawGet(pathname, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: PORT, path: pathname, method: "GET", headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end();
  });
}

async function waitForHttp(url) {
  const started = Date.now();
  while (Date.now() - started < 20_000) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // server not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}
