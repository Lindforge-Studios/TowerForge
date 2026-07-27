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
