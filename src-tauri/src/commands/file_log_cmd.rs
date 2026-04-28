use std::sync::Arc;

use serde::Serialize;
use tauri::Emitter;

use crate::models::log_entry::{LogBatchPayload, LogEntry};
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
struct SourceStatusPayload {
    source_id: String,
    status: String,
}

#[tauri::command]
pub async fn start_file_log_stream(
    source_id: String,
    file_path: String,
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
        .file_log_manager
        .start_watching(source_id, file_path, log_emitter, status_emitter)
        .await
}

#[tauri::command]
pub async fn stop_file_log_stream(
    source_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    state.file_log_manager.stop_watching(&source_id).await
}
