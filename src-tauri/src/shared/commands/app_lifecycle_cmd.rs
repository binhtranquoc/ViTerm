use tauri::Manager;

#[tauri::command]
pub fn mark_app_ready(app_handle: tauri::AppHandle) -> Result<(), String> {
    let main_window = app_handle
        .get_webview_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;

    main_window.show().map_err(|error| error.to_string())?;
    main_window
        .set_focus()
        .map_err(|error| error.to_string())?;

    if let Some(splash_window) = app_handle.get_webview_window("splash") {
        splash_window.close().map_err(|error| error.to_string())?;
    }

    Ok(())
}
