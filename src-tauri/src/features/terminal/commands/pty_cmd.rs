use std::sync::Arc;

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use tauri::Emitter;

use crate::app::state::AppState;

#[derive(Debug, Clone, Serialize)]
pub(crate) struct PtyOutputPayload {
    pub tab_id: String,
    pub data: String,
}

pub(crate) fn make_pty_output_callback(
    app_handle: tauri::AppHandle,
    tab_id: String,
) -> Arc<dyn Fn(Vec<u8>) + Send + Sync + 'static> {
    Arc::new(move |data: Vec<u8>| {
        let payload = PtyOutputPayload {
            tab_id: tab_id.clone(),
            data: STANDARD.encode(&data),
        };
        if let Err(error) = app_handle.emit("pty-output", payload) {
            eprintln!("emit pty-output error: {error}");
        }
    })
}

#[tauri::command]
pub async fn open_pty(
    tab_id: String,
    cwd: String,
    program: Option<String>,
    args: Option<Vec<String>>,
    cols: u16,
    rows: u16,
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let on_output = make_pty_output_callback(app_handle, tab_id.clone());
    let on_exit = Arc::new(|_: String| {});
    state
        .pty_manager
        .open_pty(
            tab_id,
            cwd,
            program,
            args.unwrap_or_default(),
            vec![],
            None,
            cols,
            rows,
            on_output,
            on_exit,
        )
        .await
}

#[tauri::command]
pub async fn write_pty(
    tab_id: String,
    data: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let bytes = STANDARD
        .decode(&data)
        .map_err(|error| format!("base64 decode error: {error}"))?;
    state.pty_manager.write_pty(&tab_id, &bytes).await
}

#[tauri::command]
pub async fn resize_pty(
    tab_id: String,
    cols: u16,
    rows: u16,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    state.pty_manager.resize_pty(&tab_id, cols, rows).await
}

#[tauri::command]
pub async fn close_pty(
    tab_id: String,
    instance_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    state.pty_manager.close_pty(&tab_id, &instance_id).await
}

#[tauri::command]
pub async fn force_close_pty_tab(
    tab_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    state.pty_manager.close_tab_session(&tab_id).await
}
