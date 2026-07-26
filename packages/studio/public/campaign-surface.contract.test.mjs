import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const html = fs.readFileSync(path.resolve("packages/studio/public/index.html"), "utf8");
const app = fs.readFileSync(path.resolve("packages/studio/public/app.js"), "utf8");
const server = fs.readFileSync(path.resolve("packages/studio/server.mjs"), "utf8");

function functionSource(source, name) {
  const declaration = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(source);
  const start = declaration?.index ?? -1;
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

describe("R4.4A Studio campaign surface contract", () => {
  it("keeps one opt-in campaign editor inside Rogue-lite in Mechanics Hub", () => {
    const hubStart = html.indexOf('<section id="tab-mechanics"');
    const hubEnd = html.indexOf('<section id="tab-settings"', hubStart);
    const hub = html.slice(hubStart, hubEnd);
    const ordinaryForms = `${html.slice(0, hubStart)}${html.slice(hubEnd)}`;
    const rogueliteStart = hub.indexOf('id="mechanics-roguelite-editor"');
    const rogueliteEnd = hub.indexOf('<div class="mechanics-actions">', rogueliteStart);
    const roguelite = hub.slice(rogueliteStart, rogueliteEnd);
    for (const id of [
      "mechanics-roguelite-campaign-editor",
      "mechanics-roguelite-campaign-profile-id",
      "mechanics-roguelite-campaign-json",
      "btn-campaign-preview",
      "btn-campaign-enable",
      "btn-campaign-disable",
      "campaign-preview-result"
    ]) {
      expect(roguelite, `${id} must be inside Rogue-lite`).toContain(`id="${id}"`);
      expect(ordinaryForms, `${id} must not leak into ordinary forms`).not.toContain(`id="${id}"`);
      expect(html.match(new RegExp(`id=["']${id}["']`, "g")) ?? []).toHaveLength(1);
    }
    expect(roguelite).toMatch(/Campaign|Run map/i);
    expect(roguelite).toMatch(/battle[\s\S]*elite[\s\S]*merchant[\s\S]*event[\s\S]*boss/i);
  });

  it("uses dedicated guarded campaign endpoints and never routes campaign writes through generic mechanics", () => {
    const request = functionSource(app, "campaignRequest");
    const load = functionSource(app, "loadCampaignAuthoring");
    const preview = functionSource(app, "previewCampaign");
    const apply = functionSource(app, "applyCampaign");
    expect(request).toMatch(/profileId[\s\S]*enabled/);
    expect(request).toMatch(/campaign/);
    expect(load).toMatch(/apiGet\(["']\/api\/campaign["']\)/);
    expect(preview).toMatch(/Object\.freeze\(campaignRequest\(/);
    expect(preview).toMatch(/apiPost\(["']\/api\/campaign\/preview["']/);
    expect(apply).toMatch(/requestSnapshot\s*=\s*Object\.freeze\(campaignRequest\(/);
    expect(apply).toMatch(/previewCampaign\(requestSnapshot\)/);
    expect(apply).toMatch(/apiPost\(["']\/api\/campaign\/apply["'][\s\S]*ifRevision:\s*preview\.revision/);
    expect(`${request}\n${preview}\n${apply}`).not.toMatch(/\/api\/mechanics\/(?:preview|apply)/);
  });

  it("keeps the exact edited campaign source stable across preview renders", () => {
    const request = functionSource(app, "campaignRequest");
    const render = functionSource(app, "renderCampaignAuthoring");
    const load = functionSource(app, "loadCampaignAuthoring");
    expect(request).toMatch(/\.value\s*\?\?\s*CampaignUI\.source/);
    expect(render).toMatch(/CampaignUI\.source\s*=\s*jsonInput\.value/);
    expect(render).toMatch(/jsonInput\.value\s*!==\s*CampaignUI\.source/);
    expect(render).not.toMatch(/JSON\.stringify\(CampaignUI\.campaign/);
    expect(load).toMatch(/CampaignUI\.source\s*=\s*JSON\.stringify\(CampaignUI\.campaign/);
  });

  it("delegates server read/preview/apply to MCP and requires the preview revision for writes", () => {
    expect(server).toMatch(/GET[\s\S]{0,120}\/api\/campaign[\s\S]{0,500}get_campaign/);
    expect(server).toMatch(/\/api\/campaign\/preview[\s\S]{0,900}preview_campaign/);
    expect(server).toMatch(/\/api\/campaign\/apply[\s\S]{0,900}apply_campaign/);
    expect(server).toMatch(/campaign\/apply[\s\S]{0,700}ifRevision[\s\S]{0,300}(?:428|revision_required)/);
    expect(server).toMatch(/(?:preview_campaign|apply_campaign)[\s\S]{0,180}projectDir:\s*PROJECT_DIR/);
  });

  it("preserves worldMap.campaign through ordinary Studio load/save without coupling mechanics to generic save", () => {
    const load = functionSource(app, "load");
    const save = functionSource(app, "save");
    expect(load).toContain("S.project = data");
    expect(save).toMatch(/worldMap:\s*S\.project\.worldMap/);
    expect(save).not.toMatch(/delete\s+(?:S\.project\.worldMap|body\.worldMap)\??\.campaign/);
    expect(save).not.toMatch(/\bmechanics\s*:\s*S\.project\.mechanics/);

    const saveRouteStart = server.indexOf('pathname === "/api/project/save"');
    const saveRouteEnd = server.indexOf('// \u2500\u2500 GET /api/validate', saveRouteStart);
    const saveRoute = server.slice(saveRouteStart, saveRouteEnd);
    expect(saveRoute).toMatch(/body\.worldMap\s*!==\s*undefined[\s\S]*writeJsonAtomic\(worldMapPath,\s*body\.worldMap\)/);
    expect(saveRoute).not.toMatch(/delete[\s\S]{0,100}campaign|\.campaign\s*=\s*undefined/);
  });
});
