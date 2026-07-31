## Summary

- 

## Scope And Compatibility

- [ ] This PR contains one roadmap R or one explicitly scoped maintenance change.
- [ ] New gameplay is opt-in; absent/disabled/unselected and unsupported-future paths are covered.
- [ ] Public version-domain changes, migrations, package boundaries, and forbidden scope are documented.

## TDD Evidence

- RED command / expected failure:
- GREEN focused command:
- Regression added for every verifier finding:
- Evidence recorded in `progress.md` (roadmap increments only):

## Verification

- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run build:engine`
- [ ] `npm run validate`
- [ ] `npm run sim tutorial_01 60`
- [ ] `npm run balance -- --project examples/starter.tdproj` (balance/economy/template changes)
- [ ] `npm run maps:compile -- --project examples/starter.tdproj` (map/compiler changes)
- [ ] `npm run build`
- [ ] `npm run test:e2e`
- [ ] `npm run plugin:build && npm run plugin:validate && npm run plugin:smoke` (MCP/CLI/engine dist/renderer/plugin changes)
- [ ] Mobile/desktop scaffold commands (packaging changes)
- [ ] `cargo test --manifest-path packages/desktop/src-tauri/Cargo.toml` (desktop shell changes)

## Independent Sign-Off (Roadmap Increments)

- [ ] Exact candidate frozen after final source change.
- [ ] Code Verifier: PASS, reviewer did not author production code.
- [ ] Constructor Integration Verifier: PASS, reviewer did not author production code.
- [ ] Both sign-offs were repeated after any later source change.

## Boundaries

- [ ] Engine remains DOM/Node/filesystem/Studio-free.
- [ ] TowerScript changes remain deterministic, typed, budgeted, and free of host-code execution.
- [ ] Project/agent writes are confined, revision-aware, validated, backed up, and reversible.
- [ ] Project format, validation, or build-output changes are documented.
- [ ] Generated build output is not treated as source.

## Desktop Release Safety

- [ ] Not applicable, or the unsigned release procedure in `docs/releasing.md` was followed.
- [ ] Release notes identify the build as unsigned and link the exact tag and source tree.
- [ ] Installer checksums are present in both `SHA256SUMS` and the release notes.
- [ ] User guidance does not disable Gatekeeper or remove quarantine attributes.
