# TowerForge Brand

TowerForge uses a compact product identity designed for editor chrome, desktop installers, repositories, and game-development documentation.

Product UI, player-shell, HUD, accessibility, and component rules live in the root [`DESIGN.md`](../DESIGN.md). This document remains the source of truth for the name, mark, brand assets, and deterministic exports.

## Brand idea

The mark combines three product ideas in one readable silhouette:

- the hexagon is the editable game grid;
- the central tower is the object being authored;
- the separated planes and amber spark represent deterministic assembly in a forge.

The identity should feel like a capable developer tool, not a fantasy game logo. Use precise geometry, restrained depth, and compact typography. Avoid medieval crests, flames, mascots, ornamental shields, and neon cyberpunk treatment.

## Names and copy

- Product: **TowerForge**
- Desktop editor: **TowerForge Editor** or **TowerForge Studio**
- Creator: **Lindforge Studios**
- Descriptor: **Game Constructor**
- Primary proposition: **Build tower-defense games. Visually, deterministically, with AI.**

Do not write the product name as `Tower Forge`, `Towerforge`, or `TowerForge Engine` unless referring specifically to the runtime engine package.

## Palette

| Token | Hex | Use |
| --- | --- | --- |
| Forge Black | `#111111` | Primary dark background |
| Graphite | `#1A1A1A` | Surfaces and icon body |
| Iron | `#E8E8E8` | Primary text and tower silhouette |
| Forge Green | `#7EB87E` | Primary brand accent |
| Blueprint Blue | `#6EA8D8` | Technical construction lines |
| Spark Amber | `#E8A44A` | Small highlights only |

Green is the dominant accent. Blue communicates plans, simulation, and tooling. Amber is limited to a single spark or status highlight.

## Assets

- `assets/brand/towerforge-mark.svg`: primary mark on a built-in dark tile.
- `assets/brand/towerforge-mark-mono.svg`: one-color mark for constrained contexts.
- `assets/brand/towerforge-lockup-dark.svg`: lockup for dark surfaces.
- `assets/brand/towerforge-lockup-light.svg`: lockup for light surfaces.
- `assets/brand/towerforge-readme-banner.png`: Russian repository hero.
- `assets/brand/towerforge-social-preview.png`: Russian GitHub social preview upload.
- `assets/brand/towerforge-readme-banner-en.png`: English repository hero.
- `assets/brand/towerforge-social-preview-en.png`: English social preview.
- `assets/brand/towerforge-app-icon.png`: 1024 px desktop icon source.

Keep clear space around the mark equal to at least one quarter of its width. Do not recolor individual planes, rotate the mark, add effects, place it over noisy imagery, or use the multicolor mark below 24 px. Use the monochrome mark at very small sizes.

## Generated-game engine credit

Official TowerForge builds inline the canonical multicolor mark and the exact copy **Made with
TowerForge** as a system boot splash. The engine credit appears before project/menu presentation in
Canvas and Phaser across web, single-file, PWA, mobile and desktop carriers. Project themes,
HudCatalog and MCP authoring cannot replace, restyle or suppress it. Game authors may add their own
studio/logo screen separately, without obscuring or imitating the engine credit. Because TowerForge
is MIT licensed, downstream source forks can modify their own compiler; they must not imply that a
modified identity is an official TowerForge mark.

Project-owned identities follow the engine credit through an opt-in `SplashCatalogV1` playlist.
Each selected build target may show one to eight standalone local PNG/JPEG/WebP frames. Those frames
may use the developer, publisher or game identity, but they must not copy the TowerForge mark,
`Made with TowerForge` lockup or system loading treatment. The first TowerForge slot is never stored
in project data and cannot be reordered, covered or disabled by Splash Studio, HUD or MCP.

## Rebuilding exports

Run `npm run brand:build`. The script composites exact logo and copy over the checked-in hero artwork, then exports the README banner, GitHub social preview, and 1024 px application icon. Run `npm run brand:icons` after changing the application icon source to regenerate the native Windows, macOS, Linux, Android, and iOS icon files.

The hero artwork was generated with OpenAI ImageGen and then combined with deterministic SVG and HTML layers. Image generation must never be used to render the TowerForge name, logo, legal copy, or export dimensions.
