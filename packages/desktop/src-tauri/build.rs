fn main() {
    const DESKTOP_COMMANDS: &[&str] = &[
        "desktop_sync_ui_state",
        "desktop_choose_project_parent",
        "desktop_create_project",
        "desktop_open_project",
        "desktop_open_recent",
        "desktop_open_external",
        "desktop_finish_lifecycle",
    ];
    let attributes = tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(DESKTOP_COMMANDS),
    );
    tauri_build::try_build(attributes).expect("failed to build TowerForge desktop context");
}
