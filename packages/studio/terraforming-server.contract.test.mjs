import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(".");
const SERVER = path.join(REPO_ROOT, "packages", "studio", "server.mjs");
const STARTER = path.join(REPO_ROOT, "examples", "starter.tdproj");
const PORT = 5201;
const BASE = `http://127.0.0.1:${PORT}`;
const RECIPE_IDS = Object.freeze([
  "tagged_flood",
  "tagged_moat",
  "tagged_destructible_bridge"
]);
const DEFAULT_TRANSITIONS = Object.freeze({
  tagged_flood: "flood",
  tagged_moat: "moat",
  tagged_destructible_bridge: "destroy_bridge"
});

let projectDir;
let serverProcess;

beforeAll(async () => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-c5b1-terraforming-studio-"));
  fs.cpSync(STARTER, projectDir, { recursive: true });
  serverProcess = spawn(process.execPath, [SERVER, "--project", projectDir], {
    cwd: REPO_ROOT,
    env: { ...process.env, PORT: String(PORT) },
    stdio: "pipe"
  });
  await waitForHttp(`${BASE}/api/project`);
}, 30_000);

afterAll(async () => {
  if (serverProcess?.exitCode === null) {
    serverProcess.kill();
    await new Promise((resolve) => serverProcess.once("exit", resolve));
  }
  if (projectDir) fs.rmSync(projectDir, { recursive: true, force: true });
});

function snapshotTree(rootDir) {
  const files = {};
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => (
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0
    ))) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolutePath);
      else if (entry.isFile()) files[path.relative(rootDir, absolutePath)] = fs.readFileSync(absolutePath).toString("base64");
    }
  };
  visit(rootDir);
  return files;
}

async function postJson(body) {
  const response = await fetch(`${BASE}/api/mechanics/recipe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); }
  catch { payload = { raw: text }; }
  return { response, payload };
}

describe("R3.4b C5B1 narrow Studio terraforming recipe endpoint", () => {
  it("preserves the existing read-only mechanics recipe listing", async () => {
    const before = snapshotTree(projectDir);
    const response = await fetch(`${BASE}/api/recipes?collection=mechanics`);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.recipes.find((recipe) => recipe.id === "basic_regenerating_shields"))
      .toMatchObject({ entity: { moduleId: "combat", moduleSchemaVersion: 1 } });
    expect(payload.recipes.filter((recipe) => recipe.moduleId === "terraforming").map((recipe) => recipe.id))
      .toEqual(RECIPE_IDS);
    expect(snapshotTree(projectDir)).toEqual(before);
  });

  it.each(RECIPE_IDS)("materializes %s through forced mechanics/get_recipe without changing a project byte", async (recipeId) => {
    const before = snapshotTree(projectDir);
    const transitionId = DEFAULT_TRANSITIONS[recipeId];
    const { response, payload } = await postJson({
      recipeId,
      parameters: {
        sourceTerrainTag: "path",
        destinationTerrainId: "water"
      }
    });

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      collection: "mechanics",
      recipe: {
        id: recipeId,
        moduleId: "terraforming",
        moduleSchemaVersion: 1,
        entity: {
          moduleId: "terraforming",
          moduleSchemaVersion: 1,
          profileId: recipeId,
          profile: {
            terrainTransitions: {
              [transitionId]: { fromTerrainTags: ["path"], toTerrainId: "water" }
            }
          }
        },
        towerScriptSnippet: {
          minimumSchemaVersion: 6,
          action: {
            action: "terraformTiles",
            operations: [{ kind: "set_terrain", target: "eventTile", transitionId }]
          }
        }
      }
    });
    expect(payload).not.toHaveProperty("projectDir");
    expect(JSON.stringify(payload)).not.toContain(projectDir);
    expect(snapshotTree(projectDir)).toEqual(before);
  });

  it.each([
    ["missing recipeId", { parameters: { sourceTerrainTag: "path", destinationTerrainId: "water" } }],
    ["missing parameters", { recipeId: "tagged_flood" }],
    ["extra field", { recipeId: "tagged_flood", parameters: { sourceTerrainTag: "path", destinationTerrainId: "water" }, extra: true }],
    ["caller projectDir", { recipeId: "tagged_flood", parameters: { sourceTerrainTag: "path", destinationTerrainId: "water" }, projectDir: "/tmp/forbidden.tdproj" }],
    ["malformed parameters", { recipeId: "tagged_flood", parameters: [] }],
    ["unknown source tag", { recipeId: "tagged_flood", parameters: { sourceTerrainTag: "invented", destinationTerrainId: "water" } }],
    ["unknown destination", { recipeId: "tagged_flood", parameters: { sourceTerrainTag: "path", destinationTerrainId: "invented" } }],
    ["unknown recipe", { recipeId: "invented", parameters: { sourceTerrainTag: "path", destinationTerrainId: "water" } }]
  ])("rejects %s without writes or local-path disclosure", async (_label, body) => {
    const before = snapshotTree(projectDir);
    const { response, payload } = await postJson(body);

    expect([400, 422]).toContain(response.status);
    expect(payload).toMatchObject({ code: expect.any(String) });
    expect(JSON.stringify(payload)).not.toContain(projectDir);
    expect(JSON.stringify(payload)).not.toMatch(/\/Users\/|\\Users\\|content\/mechanics\.json/);
    expect(snapshotTree(projectDir)).toEqual(before);
  });

  it("rejects malformed JSON and delegates the valid route to shared callTool/get_recipe", async () => {
    const before = snapshotTree(projectDir);
    const response = await fetch(`${BASE}/api/mechanics/recipe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not-json"
    });
    const payload = await response.json();
    expect(response.status).toBe(400);
    expect(payload).toMatchObject({ code: "malformed_request" });
    expect(JSON.stringify(payload)).not.toContain(projectDir);
    expect(snapshotTree(projectDir)).toEqual(before);

    const serverSource = fs.readFileSync(SERVER, "utf8");
    expect(serverSource).toMatch(/\/api\/mechanics\/recipe[\s\S]*callTool\(\s*["']get_recipe["']/);
    expect(serverSource).toMatch(/collection\s*:\s*["']mechanics["']/);
  });
});

async function waitForHttp(url) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error(`Timed out waiting for ${url}`);
}
