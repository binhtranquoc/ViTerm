use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::time::Duration;
use std::time::Instant;

use serde::Serialize;
use tauri::Emitter;
use tokio::sync::Mutex;

use crate::commands::ssh_host_cmd::common::{SSH_FILE_LOG_READY_MARKER, build_ssh_launch_context, schedule_temp_key_cleanup};
use crate::core::log_parser::{is_laravel_log_start, parse_line};
use crate::core::ssh_host_store;
use crate::models::log_entry::{LogBatchPayload, LogEntry};
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
struct SourceStatusPayload {
    source_id: String,
    status: String,
}

#[tauri::command]
pub async fn start_ssh_file_log_streams(
    host_id: String,
    source_id: String,
    file_paths: Vec<String>,
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let normalized_paths = file_paths
        .into_iter()
        .map(|file_path| file_path.trim().to_string())
        .filter(|file_path| !file_path.is_empty())
        .collect::<Vec<_>>();
    if normalized_paths.is_empty() {
        return Err("file_paths is empty".to_string());
    }

    stop_ssh_file_log_streams(source_id.clone(), state.clone()).await?;

    let hosts = ssh_host_store::list_ssh_hosts()?;
    let host = hosts
        .iter()
        .find(|ssh_host| ssh_host.id == host_id)
        .ok_or_else(|| format!("SSH host not found: {host_id}"))?
        .clone();
    let launch_context = build_ssh_launch_context(&host)?;
    schedule_temp_key_cleanup(launch_context.temp_paths);

    let tab_id = format!("ssh-file-log-{source_id}");
    eprintln!(
        "[ssh-file-log] start host_id={} source_id={} tab_id={} file_paths={:?}",
        host_id, source_id, tab_id, normalized_paths
    );
    let files_join = normalized_paths.join(" ");
    let source_id_for_logs = source_id.clone();
    let source_id_for_status = source_id.clone();
    let tab_id_for_initial_write = tab_id.clone();
    let files_join_for_initial_write = files_join.clone();
    let app_handle_for_logs = app_handle.clone();
    let app_handle_for_status = app_handle.clone();
    let pty_manager_for_initial_write = state.pty_manager.clone();
    let line_buffer = Arc::new(Mutex::new(String::new()));
    let pending_laravel_entry = Arc::new(Mutex::new(None::<String>));
    let pending_updated_at = Arc::new(Mutex::new(None::<Instant>));
    let current_file = Arc::new(Mutex::new(normalized_paths.first().cloned().unwrap_or_default()));
    let flush_stop_signal = Arc::new(AtomicBool::new(false));
    let (chunk_tx, mut chunk_rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
    let chunk_count = Arc::new(AtomicUsize::new(0));
    let initial_paths_written = Arc::new(AtomicBool::new(false));
    let line_buffer_for_callback = Arc::clone(&line_buffer);
    let pending_laravel_entry_for_callback = Arc::clone(&pending_laravel_entry);
    let pending_updated_at_for_callback = Arc::clone(&pending_updated_at);
    let current_file_for_callback = Arc::clone(&current_file);
    let chunk_count_for_callback = Arc::clone(&chunk_count);
    let initial_paths_written_for_callback = Arc::clone(&initial_paths_written);
    let tab_id_for_initial_write_callback = tab_id_for_initial_write.clone();
    let files_join_for_initial_write_callback = files_join_for_initial_write.clone();
    let pty_manager_for_initial_write_callback = pty_manager_for_initial_write.clone();

    let source_id_for_logs_task = source_id_for_logs.clone();
    let app_handle_for_logs_task = app_handle_for_logs.clone();
    tokio::spawn(async move {
        while let Some(chunk) = chunk_rx.recv().await {
            let text = String::from_utf8_lossy(&chunk).to_string();
            let mut buffered = line_buffer_for_callback.lock().await;
            buffered.push_str(&text);
            let mut lines = buffered
                .split('\n')
                .map(ToString::to_string)
                .collect::<Vec<_>>();
            *buffered = lines.pop().unwrap_or_default();
            drop(buffered);

            let mut entries: Vec<LogEntry> = Vec::new();
            let mut pending_entry = pending_laravel_entry_for_callback.lock().await;
            for line in lines {
                let trimmed = line.trim_end_matches('\r').trim();
                if trimmed.is_empty() {
                    continue;
                }
                if trimmed == SSH_FILE_LOG_READY_MARKER {
                    if !initial_paths_written_for_callback.swap(true, Ordering::Relaxed) {
                        let tab_id = tab_id_for_initial_write_callback.clone();
                        let files_join = files_join_for_initial_write_callback.clone();
                        let pty_manager = pty_manager_for_initial_write_callback.clone();
                        tokio::spawn(async move {
                            if let Err(error) = pty_manager
                                .write_pty(&tab_id, format!("{files_join}\n").as_bytes())
                                .await
                            {
                                eprintln!("[ssh-file-log] write initial paths failed: {error}");
                            }
                        });
                    }
                    continue;
                }
                let lower = trimmed.to_lowercase();
                if lower.contains("password:")
                    || lower.contains("passphrase")
                    || lower.contains("verification code:")
                {
                    continue;
                }
                if trimmed.starts_with("==> ") && trimmed.ends_with(" <==") {
                    if let Some(previous_entry) = pending_entry.take() {
                        let mut entry = parse_line(&previous_entry, &source_id_for_logs_task);
                        let file_path = current_file_for_callback.lock().await.clone();
                        if !file_path.is_empty() {
                            entry.fields.insert("log_file".to_string(), file_path);
                        }
                        entries.push(entry);
                    }
                    *pending_updated_at_for_callback.lock().await = None;
                    let next_path = trimmed
                        .trim_start_matches("==> ")
                        .trim_end_matches(" <==")
                        .trim()
                        .to_string();
                    let mut current = current_file_for_callback.lock().await;
                    *current = next_path;
                    continue;
                }

                if is_laravel_log_start(trimmed) {
                    if let Some(previous_entry) = pending_entry.replace(trimmed.to_string()) {
                        let mut entry = parse_line(&previous_entry, &source_id_for_logs_task);
                        let file_path = current_file_for_callback.lock().await.clone();
                        if !file_path.is_empty() {
                            entry.fields.insert("log_file".to_string(), file_path);
                        }
                        entries.push(entry);
                    }
                    *pending_updated_at_for_callback.lock().await = Some(Instant::now());
                    continue;
                }

                if let Some(current_entry) = pending_entry.as_mut() {
                    current_entry.push('\n');
                    current_entry.push_str(trimmed);
                    *pending_updated_at_for_callback.lock().await = Some(Instant::now());
                } else {
                    let mut entry = parse_line(trimmed, &source_id_for_logs_task);
                    let file_path = current_file_for_callback.lock().await.clone();
                    if !file_path.is_empty() {
                        entry.fields.insert("log_file".to_string(), file_path);
                    }
                    entries.push(entry);
                }
            }
            drop(pending_entry);

            if entries.is_empty() {
                continue;
            }

            let payload = LogBatchPayload {
                source_id: source_id_for_logs_task.clone(),
                entries,
            };
            eprintln!(
                "[ssh-file-log] emit batch source_id={} entries={}",
                source_id_for_logs_task,
                payload.entries.len()
            );
            if let Err(error) = app_handle_for_logs_task.emit("log:batch", payload) {
                eprintln!("emit log:batch failed: {error}");
            }
        }
    });
    let on_output = Arc::new(move |chunk: Vec<u8>| {
        let count = chunk_count_for_callback.fetch_add(1, Ordering::Relaxed) + 1;
        if count <= 5 || count % 50 == 0 {
            let text = String::from_utf8_lossy(&chunk).to_string();
            let lower = text.to_lowercase();
            let credential_prompted = lower.contains("password:")
                || lower.contains("passphrase")
                || lower.contains("verification code:");
            if credential_prompted {
                eprintln!(
                    "[ssh-file-log] credential prompt detected source_id={} chunk_count={}",
                    source_id_for_logs, count
                );
            }
            let mut lines_sample: Vec<String> = Vec::new();
            for line in text.lines().take(5) {
                let trimmed_line = line.trim().to_string();
                if !trimmed_line.is_empty() {
                    lines_sample.push(trimmed_line.chars().take(120).collect::<String>());
                }
            }
            let sample = lines_sample.join(" | ");
            let tail = text
                .chars()
                .rev()
                .collect::<String>()
                .chars()
                .rev()
                .take(160)
                .collect::<String>();
            eprintln!(
                "[ssh-file-log] chunk sample source_id={} chunk_count={} sample={} tail={}",
                source_id_for_logs,
                count,
                sample,
                tail.chars().take(160).collect::<String>()
            );
        }
        let _ = chunk_tx.send(chunk);
    });

    let on_exit = Arc::new(move |reason: String| {
        let payload = SourceStatusPayload {
            source_id: source_id_for_status.clone(),
            status: "error".to_string(),
        };
        eprintln!(
            "[ssh-file-log] on_exit source_id={} reason={}",
            source_id_for_status, reason
        );
        let _ = app_handle_for_status.emit("source-status", payload);
    });

    let source_id_for_flush = source_id.clone();
    let app_handle_for_flush = app_handle.clone();
    let pending_laravel_entry_for_flush = Arc::clone(&pending_laravel_entry);
    let pending_updated_at_for_flush = Arc::clone(&pending_updated_at);
    let current_file_for_flush = Arc::clone(&current_file);
    let flush_stop_signal_for_task = Arc::clone(&flush_stop_signal);
    tokio::spawn(async move {
        while !flush_stop_signal_for_task.load(Ordering::Relaxed) {
            tokio::time::sleep(Duration::from_millis(250)).await;
            if flush_stop_signal_for_task.load(Ordering::Relaxed) {
                break;
            }

            let should_flush = pending_updated_at_for_flush
                .lock()
                .await
                .map(|last_updated| last_updated.elapsed() >= Duration::from_millis(500))
                .unwrap_or(false);
            if !should_flush {
                continue;
            }

            let previous_entry = pending_laravel_entry_for_flush.lock().await.take();
            if let Some(previous_entry) = previous_entry {
                *pending_updated_at_for_flush.lock().await = None;
                let mut entry = parse_line(&previous_entry, &source_id_for_flush);
                let file_path = current_file_for_flush.lock().await.clone();
                if !file_path.is_empty() {
                    entry.fields.insert("log_file".to_string(), file_path);
                }
                let payload = LogBatchPayload {
                    source_id: source_id_for_flush.clone(),
                    entries: vec![entry],
                };
                let _ = app_handle_for_flush.emit("log:batch", payload);
            }
        }
    });

    let remote_script = format!(
        r#"
        FILES=""
        printf "%s\n" "{SSH_FILE_LOG_READY_MARKER}"

        while true; do
        TAIL_PID=""
        if [ -n "$FILES" ]; then
            tail -n 200 -F -v $FILES 2>&1 &
            TAIL_PID=$!
        fi

        NEWFILES=""
        while IFS= read -r NEWFILES; do
            NEWFILES="$(printf "%s" "$NEWFILES" | tr -d '\r')"
            case "$NEWFILES" in
            ""|"-")
                continue
                ;;
            /*)
                FILES="$NEWFILES"
                break
                ;;
            *)
                continue
                ;;
            esac
        done || break

        if [ -n "$TAIL_PID" ]; then
            kill "$TAIL_PID" 2>/dev/null || true
        fi
        done
        "#
    );
    eprintln!(
        "[ssh-file-log] remote_script(wrapper)={}",
        remote_script.replace('\n', "\\n")
    );
    let mut ssh_args = launch_context.ssh_args;
    ssh_args.push("sh".to_string());
    ssh_args.push("-lc".to_string());
    ssh_args.push(remote_script);

    let instance_id = state
        .pty_manager
        .open_pty(
            tab_id.clone(),
            ".".into(),
            Some("ssh".into()),
            ssh_args,
            vec![],
            launch_context.auto_password,
            120,
            40,
            on_output,
            on_exit,
        )
        .await?;

    state
        .ssh_file_log_sessions
        .lock()
        .await
        .insert(source_id.clone(), (tab_id, instance_id, flush_stop_signal));

    let payload = SourceStatusPayload {
        source_id,
        status: "running".to_string(),
    };
    app_handle
        .emit("source-status", payload)
        .map_err(|error| format!("emit source-status failed: {error}"))?;
    Ok(())
}

#[tauri::command]
pub async fn stop_ssh_file_log_streams(
    source_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let session = state.ssh_file_log_sessions.lock().await.remove(&source_id);
    if let Some((tab_id, instance_id, flush_stop_signal)) = session {
        flush_stop_signal.store(true, Ordering::Relaxed);
        let _ = state.pty_manager.close_pty(&tab_id, &instance_id).await;
    }
    Ok(())
}

#[tauri::command]
pub async fn update_ssh_file_log_paths(
    source_id: String,
    file_paths: Vec<String>,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let normalized_paths = file_paths
        .into_iter()
        .map(|file_path| file_path.trim().to_string())
        .filter(|file_path| !file_path.is_empty())
        .collect::<Vec<_>>();

    if normalized_paths.is_empty() {
        return Err("file_paths is empty".to_string());
    }

    let files_join = normalized_paths.join(" ");
    let session = state.ssh_file_log_sessions.lock().await.get(&source_id).cloned();
    let Some((tab_id, _instance_id, _flush_stop_signal)) = session else {
        return Err(format!("ssh file log session not found for source_id={source_id}"));
    };

    state
        .pty_manager
        .write_pty(&tab_id, format!("{files_join}\n").as_bytes())
        .await
        .map_err(|error| format!("write_pty failed: {error}"))?;

    Ok(())
}
