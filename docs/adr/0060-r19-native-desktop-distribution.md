# ADR 0060: R19 Native Desktop Distribution

- Status: Accepted
- Date: 2026-08-03

## Context

R18 added an opt-in large-screen browser player, but the existing `package --kind desktop` path is
only a compatibility wrapper around a web target. It silently chooses the first web target, emits a
minimal Tauri scaffold with a fixed window and `csp: null`, requires manual icon generation, and has
no native session storage, lifecycle contract, release workflow, or updater boundary.

The Tauri application in `packages/desktop` is the TowerForge constructor itself. Generated games
must not inherit its Node sidecar, project commands, ACL, filesystem access, entitlements, or release
configuration.

## Decision

R19 remains opt-in within project schema v5 and BuildTargets v2. A generated native game is authored
as `platform: "desktop"` and owns its renderer, form factor, viewport, window and bundle settings.
`defaults.desktop` selects a native target independently from `defaults.web`. The R18
`desktop_large_screen` recipe remains a web target; R19 adds the distinct
`native_desktop_game` recipe. An explicit legacy web target may still be passed to
`package --kind desktop`, but only through the documented compatibility adapter.
Reads and guarded applies return the authoritative `defaults` record; committing a first-class
desktop target selects it as `defaults.desktop`. Packaging without an explicit target requires that
authored default and fails before output mutation when it is missing. It never guesses from target
order or borrows `defaults.web`.

The first-class target never searches for a sibling web target. The CLI compiles the selected
desktop target through the common generated-player builder, then emits a separate Tauri v2 carrier.
Window and bundle records are closed own-data contracts. Output paths and the project-bound
1024×1024 PNG icon remain confined to the project. Every native target owns an isolated
`desktop-<target-id>` output by default; authored outputs cannot be equal, ancestors or descendants
of another web/native output, so packaging one target cannot mix or overwrite another carrier.
Every generated scaffold read, write and bounded cleanup validates its exact destination again with
`lstat`; pre-existing file, dangling-file or directory symlinks that could redirect a repack outside
the active project are rejected before mutation. This applies to icon variants, Tauri/Capacitor manifests, release scripts,
updater sources, build caches and lockfiles rather than only to the carrier's top-level output path.
Studio rewrites a platform default when its selected target is renamed and removes that default
when the target is deleted. A rename to an existing target ID is rejected before either record is
mutated; a successful rename rerenders the card so later edits bind the new stable ID. Generated configuration uses a restrictive CSP,
does not enable global Tauri APIs, and grants only the narrow commands required by the game.

R19.2 reuses `PlayerSessionSaveV1` and `createRotatingPlayerSessionStore` behind
`NativeStorageBridgeV1`. Rust owns the app-data paths and exposes no arbitrary path argument or
general filesystem/shell command. Slot and head updates use cross-platform replace-on-persist
without deleting the committed destination first. Ordinary close is prevented until the WebView
flushes and explicitly completes the close handshake. On desktop, WebView focus loss is the
supported suspend/save boundary, while focus gain and Tauri's event-loop resume signal restoration;
fullscreen reads the authoritative Tauri window state before toggling or updating ARIA/preferences,
and single-instance behavior uses separate bounded events/commands. Browser and native
restore must produce the same simulation digest.

R19.3 emits a project-owned release workflow for `.dmg`, `.exe`, `.msi`, `.AppImage`, `.deb` and
`.rpm`, plus `SHA256SUMS` and release notes tied to the exact source commit. Signing configuration
contains intent only; secret values stay in OS/CI storage. If signing is not configured, the release
is labelled `Unsigned build` and published only as a pre-release. Generated Actions are pinned by
immutable commit, Node/Rust toolchains and direct native dependencies are fixed, artifact assembly
is recursive and requires exactly six installers before checksums/publication. Jobs call the Tauri
CLI directly with a quoted bundle list so PowerShell/npm cannot split a multi-format request. The
macOS job imports the author certificate, then verifies the built app signature and stapled
notarization ticket from the DMG; the Windows job imports the authored PFX and accepts `signed`
status only after Authenticode validation against the imported thumbprint. The repository-owned R19
acceptance workflow generates a carrier from current source and builds all six formats on native
macOS, Windows and Linux runners before accepting the delivery contract. Windows post-build
verification scans only the selected NSIS/MSI bundle directory, never application executables from
the broader Cargo target tree.

R19.4 is wholly absent unless the target enables it. Enabled updater configuration accepts HTTPS
endpoints and a public verification key only. Private keys remain CI secrets. Signature, downgrade,
platform/architecture and manifest validation are owned by the native Tauri updater and must
complete before installation begins. The WebView cannot supply a `signatureStatus`, updater
resource ID or arbitrary candidate and receives no direct updater plugin permission. The enabled
release workflow stages the Tauri-produced update payload and adjacent detached `.sig`, then emits
the signed static `latest.json` platform map beside installers and checksums. Platform keys derive
from the actual bounded runner OS/architecture, including Intel and Apple Silicon macOS runners.
Disabled carriers omit the updater scripts, signing-guide secret names, payload paths and metadata
bytes entirely. Repackaging an existing enabled carrier as disabled removes generated updater-only
sources plus the disposable native build directory and generated Cargo lock that could retain
compiled updater code or signed payloads. Unrelated carrier files remain untouched.

The engine, GameCommand v8, checkpoint, journal, profile, campaign, multiplayer,
`PlayerSessionSaveV1` and `PlayerPreferencesV1` version domains do not change.

## TDD delivery slices

1. R19.1a: BuildTargets validation, desktop selection and guarded authoring recipe.
2. R19.1b: standalone secure carrier, project icon and compatibility wrapper.
3. R19.1c: Studio and MCP/AI parity.
4. R19.2a: native session storage and browser/native digest parity.
5. R19.2b: close, sleep/resume, fullscreen and single-instance lifecycle.
6. R19.3a: local installer commands and artifact verification.
7. R19.3b: generated cross-platform GitHub workflow and unsigned policy.
8. R19.4: disabled absence, guarded configuration and updater rejection paths.

Each slice records focused RED before production work, then runs affected-layer regressions. The
complete unit, browser, plugin, package and Cargo gates run only on the frozen R19 candidate, before
two independent sign-offs. Any source change invalidates both sign-offs.

## Acceptance

The exact frozen production source is
`9a386303d2d894e17ba81d927074622efe0a912d`. Focused R19 contracts pass 90/90, the complete unit
suite passes 4113/4113, Playwright passes 157/157, and the desktop Rust suite passes 9/9. GitHub CI
runs `30788623051` and `30788623046` are green for that exact commit; the generated-game matrix
builds and accepts `.dmg`, `.exe`, `.msi`, `.AppImage`, `.deb` and `.rpm` artifacts.

The locally generated macOS DMG passed `hdiutil verify`, launched its application from the mounted
read-only image, and has SHA-256
`00e9cbe161ba88c8acbf17495bf2848801bfc94830ef91b461b383d8ce0b271f`. Fresh independent Code
Verifier and Constructor Integration Verifier audits both issued explicit sign-off for the frozen
source after checking exact, intermediate and dangling symlink confinement, Studio target
transactions, updater opt-in/cleanup, native lifecycle/storage, disabled/legacy behavior, MCP/plugin
parity and all six installer formats. No actionable findings remain.

## Consequences

- A project can contain R18 web-desktop and R19 native-desktop targets without either target
  borrowing the other's settings.
- Generated games do not import the TowerForge constructor shell or its privileges.
- Native persistence changes only the storage port, not the gameplay save format.
- Cross-platform installers are produced in CI; a local build creates only formats supported by the
  current operating system that are also authored by the selected target.
- Updater code and permissions are absent from ordinary desktop games.

## Rejected alternatives

- Continuing to wrap the first web target: mixes unrelated target contracts and makes native builds
  non-reproducible.
- Reusing `packages/desktop`: would expose constructor-specific sidecars and privileges to games.
- Storing signing or updater private keys in `.tdproj`: violates local-first secret ownership.
- Enabling a broad filesystem or shell plugin for saves: expands the WebView attack surface.
