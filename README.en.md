<p align="center">
  <img src="assets/brand/towerforge-readme-banner-en.png" alt="TowerForge — build tower-defense games visually, deterministically, with AI" width="100%">
</p>

<p align="center"><a href="README.md">Русский</a> · <strong>English</strong></p>

# TowerForge

**TowerForge by Lindforge Studios — build your own tower defense game.**

[![License: MIT](https://img.shields.io/badge/license-MIT-7EB87E.svg)](LICENSE)
[![Node.js 22](https://img.shields.io/badge/Node.js-22%2B-6EA8D8.svg)](package.json)
[![Desktop: Tauri 2](https://img.shields.io/badge/desktop-Tauri%202-E8A44A.svg)](packages/desktop)
[![Local first](https://img.shields.io/badge/data-local--first-7EB87E.svg)](ARCHITECTURE.md)

TowerForge is an open-source, content-agnostic constructor for 2D tower-defense games with per-map hex and square grids. It provides a deterministic TypeScript simulation engine, a local `.tdproj` editor, a Wang/autotile pipeline, safe project-authored TowerScripts, validation/headless/balance tooling, and mobile, large-screen web, and native desktop player targets with Canvas or Phaser, presentation-only camera projections, and a data-only HUD.

## Downloads

Desktop builds are published on [GitHub Releases](https://github.com/Lindforge-Studios/TowerForge/releases). Current alpha builds are explicitly marked **Unsigned build**. Verify the downloaded installer against the attached `SHA256SUMS` file before opening it. macOS installation notes and the unsigned-distribution policy live in [docs/releasing.md](docs/releasing.md).

## Current status

The current public version is the unsigned [v0.8.0 pre-release](https://github.com/Lindforge-Studios/TowerForge/releases/tag/v0.8.0). It adds the Large-Screen Web Player, first-class native desktop distribution, isometric/dimetric camera profiles, and the data-only HUD Studio to R0–R17. Presentation and gameplay extensions remain opt-in, and legacy targets are unchanged. The exact delivery status and boundaries live in the [roadmap](docs/ROADMAP.md).

## Product surface

| Product | What it is | Where |
| --- | --- | --- |
| **TowerForge Editor** | Map, content & balance editor (the Studio) | `packages/studio` |
| **TowerForge Desktop** | Installable Studio shell for Windows, macOS, and Linux | `packages/desktop` |
| **TowerForge AI** | AI assistant / MCP agent — drives the author → simulate → balance → patch loop | `packages/mcp` |
| **TowerForge Runtime** | Deterministic engine + renderers that run the built game | `packages/engine`, `packages/renderer` |
| **TowerForge Market** | Templates, assets, maps (planned — see `docs/ROADMAP.md`) | — |
| **TowerForge Academy** | Learning to build games (planned) | — |

## Quick Start

```bash
npm install
npm run studio
```

Studio opens at `http://localhost:5174` and edits `examples/starter.tdproj` by default. Russian is the default interface language; choose English in **Settings → Appearance → Language**.

## Common Commands

| Task | Command |
| --- | --- |
| Install | `npm install` |
| Create a project | `npx towerforge create my-game --template classic --grid square`; grids: `hex`/`square`, templates: `classic`, `maze`, `idle`, `roguelike` |
| Run Studio | `npm run studio` |
| Run MCP server | `npm run mcp -- --project examples/starter.tdproj` |
| Build Codex plugin | `npm run plugin:build` |
| Validate Codex plugin | `npm run plugin:validate && npm run plugin:smoke` |
| Connect an AI client (Claude Code / Codex / Claude Desktop / Cursor / VS Code) | `npx towerforge mcp:connect <project> [--client <id> --write]` — or the client picker in Studio → Settings → AI Agent Integration |
| Validate project | `npm run validate` |
| Validate as JSON | `npm run validate -- --json` |
| Simulate starter mission | `npm run sim tutorial_01 60` |
| Simulate as JSON | `npm run sim tutorial_01 60 -- --json` |
| Run balance sweep | `npm run balance -- --project examples/starter.tdproj` |
| Run Persona QA | `npm run persona-qa -- --project examples/starter.tdproj --mission tutorial_01 --seed smoke --seconds 20` |
| Compile map sources | `npm run maps:compile -- --project examples/starter.tdproj` |
| Write schema migrations | `npm run migrate -- --project examples/starter.tdproj --write` |
| Typecheck engine | `npm run typecheck` |
| Compile engine runtime | `npm run build:engine` |
| Build playable web bundle | `npm run build` |
| Build with double-clickable single HTML | `npm run build -- --single-file` |
| Package portable web ZIP + loopback launcher | `npm run package:web -- --project examples/starter.tdproj` |
| Export verified project handoff | `npm run project:export -- --project examples/starter.tdproj --out game.tdpack` |
| Import verified project handoff | `npm run project:import -- game.tdpack --dir ./projects` |
| List bundled visual themes | `npm run themes:list` |
| Preview/apply a visual theme | `npm run themes:apply -- verdant-frontier --project examples/starter.tdproj --dry-run` |
| Package mobile scaffold | `node packages/cli/package.mjs --project examples/starter.tdproj --kind mobile` |
| Package desktop scaffold | `node packages/cli/package.mjs --project examples/starter.tdproj --kind desktop` |
| Run desktop Studio shell | `npm run desktop:dev` |
| Build desktop Studio installers | `npm run desktop:build` |
| Build platform-specific Studio installers | `npm run desktop:build:mac`, `npm run desktop:build:win`, or `npm run desktop:build:linux` |
| Rebuild brand banners | `npm run brand:build` |
| Rebuild native icons | `npm run brand:icons` |
| Rebuild bundled tile sheets | `npm run tiles:build-presets` |
| Unit and integration tests | `npm run test` |
| Browser smoke test | `npm run test:e2e` |

The build command writes `examples/starter.tdproj/dist` for the starter project. Studio can open the built game in its confined preview. From a terminal, preview it with a loopback static server:

```bash
python3 -m http.server 5175 --bind 127.0.0.1 --directory examples/starter.tdproj/dist
```

Then open `http://127.0.0.1:5175`.

## Project Format

A `.tdproj` directory is the source of a game:

- `project.json` stores project metadata.
- `content/balance.json` stores constants, the typed terrain registry, difficulties, meta progression/rewards, abilities, enemies, towers, waves, and missions.
- `content/mechanics.json` is an optional versioned catalog of opt-in mechanics; without it the project retains legacy behavior.
- `content/world-map.json` stores regions and mission nodes.
- `content/visuals.json` stores the v2 visual catalog; schema v3 optionally adds declarative `proceduralJuice` v1, while schema v4 adds presentation-only camera profiles and view variants.
- `content/distribution.json` optionally stores Distribution v1 reproducible-publish, Remix-policy, and host-only monetization metadata.
- `content/hud.json` optionally stores the data-only `HudCatalogV1` for responsive HUD, screens, and build menus.
- `content/story-comics.json` stores mission-linked narrative panels.
- `content/battle-backgrounds.json` stores mission colors and optional sprite backdrops.
- `maps/src/*.tmj` stores editable hex/odd-r or square/cardinal map sources.
- `maps/compiled/maps.json` stores runtime map definitions generated from source maps.
- `scripts/**/*.tower.json` stores deterministic custom gameplay; TowerScript v7 optionally adds Behavior Trees and HFSM while v1–v6 keep their previous path.
- `build-targets.json` stores output targets; v2 adds opt-in `desktop | responsive` form factors, a first-class native desktop target, and camera/HUD/splash profile bindings.
- `content/splashes.json` optionally stores `SplashCatalogV1` with 1–8 local PNG/JPEG/WebP frames after the mandatory system splash.
- `.towerforge/` stores local editor state and backups and MUST NOT be committed.

A mission selects catalog profiles through `mission.mechanics`; defining a profile does not activate it. Implemented independent profiles cover combat/reactions, navigation/elevation/physics/terraforming, roguelite, heroes, logistics, director, quests, multiplayer, enemy behaviors, ballistics, and weather. Mechanics Hub and AI/MCP expose recipe prerequisites but never activate dependencies or auto-patch terrain, map, tower, or ability data. Ordinary starter projects do not contain `content/mechanics.json` and retain the legacy path. Exact versions, dependencies, and checkpoint/snapshot contracts live in [ARCHITECTURE.md](ARCHITECTURE.md); authoring workflows live in the [runbook](docs/runbook.md) and [reference examples](docs/examples/README.md).

## Architecture

Canonical module boundaries and invariants live in [ARCHITECTURE.md](ARCHITECTURE.md). Product architecture and roadmap details live in [docs/td-constructor-architecture.md](docs/td-constructor-architecture.md).

The shared Studio, player-shell, and HUD style guide lives in [DESIGN.md](DESIGN.md). Brand assets, palette, naming, and export instructions live in [docs/brand.md](docs/brand.md). The checked-in [English social preview](assets/brand/towerforge-social-preview-en.png) is ready for GitHub repository settings; a [Russian version](assets/brand/towerforge-social-preview.png) is included alongside it.

Every game emitted by the official TowerForge compiler shows the built-in **Made with TowerForge** system splash before its game menu. It is shared by Canvas/Phaser and web/mobile/desktop carriers and cannot be disabled through project data or HUD authoring. R22 lets each build target add 1–8 developer/publisher frames after it; without an explicit binding, legacy output is unchanged.

## Simulation And Balance Reports

`npm run sim ... -- --json` and the MCP `simulate_mission` tool return an agent-readable smoke report: outcome, aggregate event counts, event timeline, resource timeline, milestone snapshots, the deterministic strategy used, and next valid actions. `npm run balance` and MCP `balance_report` run a deterministic multi-strategy sweep with per-mission win rate, surviving core HP, tower usage, strategy metadata, and advisor flags.

## Agent Harness

Agent policy lives in [AGENTS.md](AGENTS.md). Operations are in [docs/runbook.md](docs/runbook.md), release policy is in [docs/releasing.md](docs/releasing.md), architecture decisions are in [docs/adr/](docs/adr/), and reference examples are in [docs/examples/](docs/examples/).

Studio **AI Chat** and external MCP clients share the same tool registry and authoring policy. Domain-scoped schema discovery teaches agents when to use universal effects, TowerScript, difficulty/meta progression, or themes. Tools advertise risk metadata and prefer previewed, revision-guarded writes such as `apply_progression_patch`, `upsert_tower_script`, `apply_theme_pack`, granular entity/map/asset/narrative operations, validation, and rollback over broad replacement. Compact reads expose project concepts without raw filesystem access. Settings offers ChatGPT OAuth through Codex App Server, Claude account auth through the bundled Claude Agent SDK/runtime, and direct Anthropic, OpenAI, or OpenRouter keys. The right-side chat supports Ask/Plan/Act permissions, model catalogs, reasoning effort, images, and locally sampled video frames; official runtimes retain ownership of OAuth credentials.

Codex users can install the generated public marketplace from [towerforge-codex-plugin](https://github.com/Lindforge-Studios/towerforge-codex-plugin). Its release bundle is built deterministically from [`plugins/towerforge`](plugins/towerforge) in this repository. The plugin adds a skill and a local MCP runtime without an API key or TowerForge cloud account. It discovers `.tdproj` projects only inside the current Codex workspace roots, does not accept an absolute model-selected `projectDir`, and redacts local paths from responses. Installation and the security model are documented in the [runbook](docs/runbook.md#codex-marketplace-plugin).

## License

MIT. See [LICENSE](LICENSE).
