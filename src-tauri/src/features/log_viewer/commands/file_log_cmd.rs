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
pub async fn start_file_log_stream(
    source_id: String,
    file_path: String,
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    start_file_log_streams(source_id, vec![file_path], app_handle, state).await
}

#[tauri::command]
pub async fn start_file_log_streams(
    source_id: String,
    file_paths: Vec<String>,
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let normalized_paths = file_paths
        .into_iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .collect::<Vec<_>>();
    if normalized_paths.is_empty() {
        return Err("file_paths is empty".to_string());
    }
    eprintln!(
        "[file-log-debug] start source_id={} files={:?}",
        source_id, normalized_paths
    );

    let grouped_source_ids = normalized_paths
        .iter()
        .enumerate()
        .map(|(index, _)| format!("{source_id}::file::{index}"))
        .collect::<Vec<_>>();
    state
        .file_log_groups
        .lock()
        .await
        .insert(source_id.clone(), grouped_source_ids.clone());

    let app_handle_for_log = app_handle.clone();
    let app_handle_for_status = app_handle.clone();
    let source_id_for_log = source_id.clone();
    let source_id_for_status = source_id.clone();

    let log_emitter = Arc::new(move |entries: Vec<LogEntry>| {
        eprintln!(
            "[file-log-debug] emit batch source_id={} entries={}",
            source_id_for_log,
            entries.len()
        );
        let payload = LogBatchPayload {
            source_id: source_id_for_log.clone(),
            entries,
        };
        if let Err(error) = app_handle_for_log.emit("log:batch", payload) {
            eprintln!("emit log:batch failed: {error}");
        }
    });

    let status_emitter = Arc::new(move |_status_source_id: String, status: String| {
        eprintln!(
            "[file-log-debug] status source_id={} status={}",
            source_id_for_status, status
        );
        let payload = SourceStatusPayload {
            source_id: source_id_for_status.clone(),
            status,
        };
        if let Err(error) = app_handle_for_status.emit("source-status", payload) {
            eprintln!("emit source-status failed: {error}");
        }
    });

    for (index, file_path) in normalized_paths.iter().enumerate() {
        let watcher_source_id = grouped_source_ids
            .get(index)
            .cloned()
            .unwrap_or_else(|| source_id.clone());
        state
            .file_log_manager
            .start_watching(
                watcher_source_id,
                file_path.to_string(),
                log_emitter.clone(),
                status_emitter.clone(),
            )
            .await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn stop_file_log_stream(
    source_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    stop_file_log_streams(source_id, state).await
}

#[tauri::command]
pub async fn stop_file_log_streams(
    source_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    if let Some(group_ids) = state.file_log_groups.lock().await.remove(&source_id) {
        eprintln!(
            "[file-log-debug] stop group source_id={} child_ids={:?}",
            source_id, group_ids
        );
        for child_id in group_ids {
            let _ = state.file_log_manager.stop_watching(&child_id).await;
        }
        return Ok(());
    }
    eprintln!("[file-log-debug] stop source_id={}", source_id);
    state.file_log_manager.stop_watching(&source_id).await
}
