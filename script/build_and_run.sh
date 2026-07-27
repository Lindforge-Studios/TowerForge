#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-run}"
APP_NAME="towerforge_desktop"
BUNDLE_ID="com.lindforge.towerforge"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_BUNDLE="$ROOT_DIR/packages/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/TowerForge.app"
APP_BINARY="$APP_BUNDLE/Contents/MacOS/$APP_NAME"
WINDOW_VERIFIER="$ROOT_DIR/packages/desktop/scripts/verify-visible-window.swift"

pkill -x "$APP_NAME" >/dev/null 2>&1 || true
pkill -f "$APP_BUNDLE/Contents/Resources/runtime/packages/desktop/sidecar/studio-sidecar.mjs" >/dev/null 2>&1 || true

npm --prefix "$ROOT_DIR" --workspace @towerforge/desktop run build -- --bundles app --target aarch64-apple-darwin

open_app() {
  /usr/bin/open -n "$APP_BUNDLE"
}

case "$MODE" in
  run)
    open_app
    ;;
  --debug|debug)
    lldb -- "$APP_BINARY"
    ;;
  --logs|logs)
    open_app
    /usr/bin/log stream --info --style compact --predicate "process == \"$APP_NAME\""
    ;;
  --telemetry|telemetry)
    open_app
    /usr/bin/log stream --info --style compact --predicate "subsystem == \"$BUNDLE_ID\""
    ;;
  --verify|verify)
    open_app
    for _ in {1..30}; do
      if pgrep -x "$APP_NAME" >/dev/null \
        && pgrep -f "$APP_BUNDLE/Contents/Resources/runtime/packages/desktop/sidecar/studio-sidecar.mjs" >/dev/null; then
        APP_PID="$(pgrep -x "$APP_NAME" | head -n 1)"
        sleep 2
        if /usr/bin/swift "$WINDOW_VERIFIER" "$APP_PID"; then
          echo "TowerForge app, Studio sidecar, and visible window are ready."
          exit 0
        fi
        echo "TowerForge processes started, but no visible Studio window was found." >&2
        exit 1
      fi
      sleep 1
    done
    echo "TowerForge app or Studio sidecar did not become ready within 30 seconds." >&2
    exit 1
    ;;
  *)
    echo "usage: $0 [run|--debug|--logs|--telemetry|--verify]" >&2
    exit 2
    ;;
esac
