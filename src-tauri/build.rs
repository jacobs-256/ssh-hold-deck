fn main() {
    println!("cargo:rerun-if-env-changed=TAURI_UPDATER_PUBLIC_KEY");
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&["desktop_settings", "desktop_save_backup", "desktop_update", "desktop_open_link"]),
        ),
    ).expect("Unable to build desktop permissions");
}
