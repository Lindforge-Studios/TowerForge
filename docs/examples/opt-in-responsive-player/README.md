# Explicit responsive player fixture

Start with an unchanged `classic` template or `examples/starter.tdproj`. Without applying the
fixture, the existing target remains legacy: no session/fixed-clock/compact-shell imports.
Use read_player_targets → get_player_target_recipe (`responsive_web_mobile`, targetId
`responsive`) → preview_player_target → apply_player_target with the preview revision.
`target.json` shows the detached target for an unused output directory. Never overwrite
build-targets.json with this fragment. The guarded transaction promotes only manifest and
build-target versions and retains prior targets/defaults. Select the new target explicitly.

The R23 authoring contract compares this fixture with the recipe and proves inert preview,
legacy retention and stale-revision rejection. The browser matrix covers both grids/renderers
in Chromium/WebKit with session recovery and 390×844 / 844×390 touch controls.
