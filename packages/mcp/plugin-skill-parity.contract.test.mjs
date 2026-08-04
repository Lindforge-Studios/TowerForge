import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SKILL_PATH = path.resolve("plugins/towerforge/skills/towerforge-authoring/SKILL.md");

describe("public TowerForge authoring skill parity through R21", () => {
  it("routes every post-R11 domain through its narrow discovery and guarded workflow", () => {
    const skill = fs.readFileSync(SKILL_PATH, "utf8");
    const workflows = [
      ["Enemy Behaviors", "basic_targetable_boss_components", "preview_mechanics_module", "apply_mechanics_module"],
      ["Ballistics", "basic_projectile_ballistics", "preview_destructible_environment", "apply_destructible_environment"],
      ["Weather", "basic_blizzard_weather", "preview_mechanics_module", "apply_mechanics_module"],
      ["Arsenal", "basic_modular_arsenal", "configureTowerModules", "craftGem"],
      ["Macro-Economy", "basic_local_market", "preview_mechanics_module", "apply_mechanics_module"],
      ["Replay Lab", "inspect_replay_archive", "verify_replay_archive", "analyze_replay_branch"],
      ["Distribution", "read_distribution_config", "preview_distribution_config", "apply_distribution_config", "preview_publish_candidate"],
      ["player targets", "read_player_targets", "desktop_large_screen", "native_desktop_game", "apply_player_target"],
      ["Camera", "get_camera_profiles", "preview_camera_profile", "apply_camera_profile"],
      ["HUD", "get_hud_profiles", "preview_hud_profile", "apply_hud_profile", "render_hud_preview"]
    ];
    for (const terms of workflows) {
      for (const term of terms) expect(skill, `missing ${term}`).toContain(term);
    }
  });

  it("preserves the human-only boundaries for external effects and secrets", () => {
    const skill = fs.readFileSync(SKILL_PATH, "utf8");
    expect(skill).toMatch(/external upload[\s\S]*(?:human|user)[\s\S]*confirm/i);
    expect(skill).toMatch(/reference relay[\s\S]*(?:must not|never)[\s\S]*(?:start|listener)/i);
    expect(skill).toMatch(/signing[\s\S]*(?:private key|secret)|(?:private key|secret)[\s\S]*signing/i);
  });
});
