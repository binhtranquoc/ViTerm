use std::sync::Arc;

use serde::Serialize;
use tauri::Emitter;

use crate::app::state::AppState;
use crate::features::log_viewer::models::log_entry::{LogBatchPayload, LogEntry};

#[derive(Debug, Clone, Serialize)]
struct SourceStatusPayload {
    source_id: String,
    status: String,
}

#[tauri::command]
pub async fn spawn_process(
    source_id: String,
    command: String,
    cwd: String,
    json_only: Option<bool>,
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let app_handle_for_log = app_handle.clone();
    let app_handle_for_status = app_handle.clone();
    let source_id_for_log = source_id.clone();
    let log_emitter = Arc::new(move |entries: Vec<LogEntry>| {
        let payload = LogBatchPayload {
            source_id: source_id_for_log.clone(),
            entries,
        };
        if let Err(error) = app_handle_for_log.emit("log:batch", payload) {
            eprintln!("emit log:batch failed: {error}");
        }
    });

    let status_emitter = Arc::new(move |status_source_id: String, status: String| {
        let payload = SourceStatusPayload {
            source_id: status_source_id,
            status,
        };
        if let Err(error) = app_handle_for_status.emit("source-status", payload) {
            eprintln!("emit source-status failed: {error}");
        }
    });

    state
        .process_manager
        .spawn_process(
            source_id,
            command,
            cwd,
            json_only.unwrap_or(false),
            log_emitter,
            status_emitter,
        )
        .await
}

#[tauri::command]
pub async fn stop_process(
    source_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    state.process_manager.stop_process(&source_id).await
}

#[tauri::command]
pub async fn send_process_input(
    source_id: String,
    input: String,
    append_newline: bool,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    state
        .process_manager
        .send_input(&source_id, &input, append_newline)
        .await
}

#[tauri::command]
pub async fn pause_process(
    source_id: String,
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    state.process_manager.pause_process(&source_id).await?;
    let payload = SourceStatusPayload {
        source_id,
        status: "paused".to_string(),
    };
    app_handle
        .emit("source-status", payload)
        .map_err(|error| format!("emit source-status failed: {error}"))?;
    Ok(())
}

#[tauri::command]
pub async fn resume_process(
    source_id: String,
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    state.process_manager.resume_process(&source_id).await?;
    let payload = SourceStatusPayload {
        source_id,
        status: "running".to_string(),
    };
    app_handle
        .emit("source-status", payload)
        .map_err(|error| format!("emit source-status failed: {error}"))?;
    Ok(())
}
