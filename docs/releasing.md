# Desktop Release Policy

TowerForge desktop artifacts are built and published through GitHub Actions. Until authenticated platform signing credentials are configured, every macOS and Windows artifact is an internal/alpha **Unsigned build**. macOS bundles still receive a complete Tauri ad-hoc signature so Apple Silicon and Gatekeeper can validate bundle integrity; this signature does not identify or authenticate the publisher.

## Published Baseline

The current release line is `v0.5.0`, an unsigned pre-release containing accepted R0–R14. A local build or GitHub Actions artifact MUST NOT be described as a release until the matching tag, public release page, installers, notes, and `SHA256SUMS` exist and have been verified.

## Release Invariants

- A release MUST point to the exact git tag and commit used for the build.
- A macOS release MUST set Tauri `bundle.macOS.signingIdentity` to `-` until a Developer ID identity replaces it, include the JIT entitlements required by the hardened bundled Node runtime, target `aarch64-apple-darwin`, and pass strict deep `codesign` verification before upload.
- An unsigned release MUST be a GitHub pre-release and MUST include `Unsigned build` in its title and warning block.
- Release assets MUST include every platform installer and a plain-text `SHA256SUMS` file.
- Release notes MUST repeat the full SHA-256 value for every attached installer and link to both the tag and tagged source tree.
- Release notes MUST NOT recommend `xattr -d`, disabling Gatekeeper, or reducing operating-system security.
- A manual `Unsigned Desktop Builds` run produces a private release-candidate artifact for inspection but does not publish a release.
- A pushed `vX.Y.Z` tag publishes only after every platform build and release-assembly job succeeds.
- GitHub Actions artifacts are build evidence, not public releases. A release is complete only after its assets and notes are visible on the repository Releases page.

## Automated Pipeline

`.github/workflows/desktop-release.yml` builds on native GitHub-hosted runners:

- macOS: `.dmg`;
- Windows: NSIS `.exe` and `.msi`;
- Linux: `.AppImage`, `.deb`, and `.rpm`.

Every run creates the `towerforge-release-candidate` Actions artifact. It contains the installers, `SHA256SUMS`, and generated release notes. A manual run stops there. A tag run additionally creates a GitHub pre-release titled `TowerForge vX.Y.Z - Unsigned build` using the repository-scoped `GITHUB_TOKEN`; no provider, signing, or user API keys are exposed to the workflow.

The release assembler rejects mismatched versions across root npm, desktop npm, Tauri, and Cargo manifests, duplicate installer names, unsupported tag syntax, missing installers, and attempts to reuse an existing release tag. It never silently replaces published assets.

## Codex Plugin Mirror

`Lindforge-Studios/towerforge-codex-plugin` is a generated public marketplace, not an independent
source repository. Canonical plugin code remains under `plugins/towerforge`, `packages/mcp`, and
their dependencies in TowerForge.

The source `Build Codex Plugin Export` workflow runs manually or for `vX.Y.Z` tags. It rebuilds and
smokes the bundled runtime, exports the distribution outside the source tree, verifies every
SHA-256, and uploads a 14-day diagnostic artifact. It has read-only repository permissions.

The mirror's `Sync from TowerForge` workflow runs every six hours and on manual dispatch. It reads
public `TowerForge/main`, repeats the same gates, and pushes one generated release commit through
the mirror-scoped, short-lived `GITHUB_TOKEN`. No PAT, deploy key, or cross-repository secret is
stored. If the exported source commit is exactly tagged `vX.Y.Z` and the plugin version matches,
the workflow creates the same annotated tag in the mirror without overwriting existing tags.

The mirror `build-manifest.json` MUST contain the exact source commit, TowerForge/plugin/MCP
versions, agent-guide and protocol versions, runtime requirements, and every distributed file's
size and SHA-256. The mirror's own CI rejects missing, unexpected, symlinked, or modified files.

For an immediate plugin update, manually run `Sync from TowerForge` in the mirror after source CI
passes. Keep the workflow permission at `contents: write` and do not add repository or organization
secrets. Never use a broad organization PAT for routine mirror publication.

## macOS Unsigned Build

Build and verify the Apple Silicon DMG:

```bash
npm run desktop:build:mac
npm --workspace @towerforge/desktop run verify:macos-bundle
shasum -a 256 packages/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/TowerForge_<version>_aarch64.dmg
```

Write `SHA256SUMS` using the installer basename, not an absolute path:

```text
<sha256>  TowerForge_<version>_aarch64.dmg
```

The verifier runs `codesign --verify --deep --strict` against `TowerForge.app`, requires an `arm64` main executable, starts the hardened bundled Node binary to prove V8 can initialize, and runs `hdiutil verify` against the DMG. A valid ad-hoc signature prevents an incomplete bundle signature from being misreported as a damaged download, but it is not notarization. Users may install the app by moving it to Applications. If macOS blocks the first launch because the publisher is unidentified, the only supported override is **System Settings > Privacy & Security > Open Anyway** after verifying the checksum and release source.

## Publication Checklist

1. Confirm `package.json`, desktop npm, Tauri, and Cargo versions match the intended release tag.
2. Run the relevant quality gates from `AGENTS.md`.
3. Merge the exact source commit intended for release and confirm required CI passes.
4. Run `Unsigned Desktop Builds` manually on that commit when a cross-platform release candidate is needed before tagging.
5. Create an annotated `vX.Y.Z` tag on the release commit and push it.
6. Wait for all three native builds, release assembly, and publication to pass.
7. Confirm the GitHub pre-release title contains `Unsigned build` and all six installer formats are attached when supported by the runners.
8. Download the published installers and `SHA256SUMS`, recalculate the checksums, and compare them with the release notes.
9. Run the macOS bundle verifier against the built or downloaded candidate; both strict `codesign` and `hdiutil` validation must pass.
10. Confirm the tag, tagged source, and commit links resolve to the released commit.

## Rollback

If an asset, checksum, tag, or source link is wrong, immediately mark the release as a draft or delete the release assets. Do not silently replace an installer under the same checksum. Fix the source or build, create a new patch version, regenerate all hashes, and publish new notes.

## Incident Handling

1. Record the release URL, tag, commit, asset name, reported checksum, and observed checksum.
2. Remove public access to mismatched assets while investigating.
3. Rebuild from the tagged source in a clean environment.
4. Publish a corrected patch release; do not reuse the compromised version number.
5. If signing credentials are introduced later, follow `docs/runbook.md` and the desktop ADR before removing the unsigned warning.

### v0.3.0 macOS incident

The `v0.3.0` DMG container and published checksum were valid, but the contained Apple Silicon app had only a partial linker ad-hoc signature. Strict bundle verification failed with `code has no resources but signature indicates they must be present`, so Gatekeeper reported the application as damaged. `v0.3.1` supersedes that macOS artifact by configuring Tauri's complete ad-hoc bundle signature and making strict signature verification a pre-upload CI gate. Published `v0.3.0` assets are never silently replaced.
