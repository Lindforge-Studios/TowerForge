# ADR 0064 — Explicit web/mobile readiness

Status: Candidate (requires exact-commit gates and independent code/constructor verification)

## Context

Legacy generated players and Studio passed frame-sized deltas to an engine that clamps each tick
at 0.2 units. Playback speed therefore depended on FPS. New large-screen players already own a
60 Hz clock. Legacy player sessions persist profiles, but not unfinished battles.

## Decision

- Reuse BuildTargets v2/project v5 with an explicit `responsive_web_mobile` recipe. It produces
  a separate `formFactor: responsive`, `inputProfile: hybrid` web/PWA target and a detached
  `timingNotice`. Preview/apply keep existing revision, validation, backup and rollback contracts.
  Existing targets and the default web target remain unchanged; authors choose the new target.
- Studio Playtest selects a build target and uses the same player-runtime fixed clock for desktop
  and responsive targets. Legacy targets keep the literal variable-step branch. Changing the
  target resets the local playtest; it does not rewrite project data or saved journals.
- `tickHeadless` rejects non-finite/negative durations and non-finite/non-positive steps with
  `RangeError` before ticking. Positive steps retain the 0.01 minimum and are capped to the
  engine's 0.2 maximum. It accounts for the entire duration including the remainder.
- `TowerDefenseGame.clearPresentationEvents()` acknowledges events and their processing cursor
  together. Fixed-timing adapters use it after collecting presentation events so checkpoints
  remain restorable. No command, journal, snapshot, RNG or checkpoint wire version changes.
- Existing two-slot sessions save after successful actions, wave completion, battle results,
  every five seconds while playing, and when backgrounded. An untouched new page must not
  overwrite the previous session. Restore and foreground return remain paused; no offline ticks.
  Save failures are handled and exposed as a player message, not an unhandled rejection.
- Responsive targets without an authored HUD include one browser presentation adapter. At
  widths up to 900 CSS pixels it relocates existing stats/actions into fixed top/bottom bars
  and secondary controls into a focus-trapped menu. Leaving that width restores the controls.
  The adapter owns no simulation rules. R21 custom HUD targets retain their own screen graph.
- Legacy builds do not import the compact shell or fixed-clock/session modules. Existing R18
  fixed-clock targets gain safe event acknowledgement, paused restore and bounded autosaving.

## Validation and limits

Use the 20/30/60/120 FPS × 1/2/4 clock matrix; headless invalid-input/remainder contracts;
Chromium and WebKit at 390×844 and 844×390 on Canvas/Phaser and hex/square; Continue, corrupt
slot recovery, background pause, victory/defeat/restart and profile persistence. CI installs
both browser engines. WebKit emulation is not a claim of real iPhone certification.
R22's exact source `5136d99` has successful remote CI and was merged by PR #40. The local
progress log was stale; no historical reviewer approvals are fabricated.
