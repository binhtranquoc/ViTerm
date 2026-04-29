use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tokio::fs::File;
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio::sync::{Mutex, mpsc};

use crate::core::log_parser::{is_laravel_log_start, parse_line};
use crate::models::log_entry::LogEntry;

type LogBatchCallback = Arc<dyn Fn(Vec<LogEntry>) + Send + Sync>;
type StatusCallback = Arc<dyn Fn(String, String) + Send + Sync>;
const INITIAL_READ_WINDOW_BYTES: u64 = 64 * 1024;
const MAX_BATCH_SIZE: usize = 50;
const MAX_PENDING_RECORDS: usize = 1000;
const EMIT_INTERVAL_MS: u64 = 120;
const IDLE_FLUSH_TICKS: u8 = 2;
const MISSING_FILE_ERROR_TICKS: u8 = 8;

#[derive(Clone, Default)]
pub struct FileLogManager {
    watchers: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
}

impl FileLogManager {
    pub async fn start_watching(
        &self,
        source_id: String,
        file_path: String,
        on_log_batch: LogBatchCallback,
        on_status: StatusCallback,
    ) -> Result<(), String> {
        if self.watchers.lock().await.contains_key(&source_id) {
            return Ok(());
        }

        let stop_signal = Arc::new(AtomicBool::new(false));
        self.watchers
            .lock()
            .await
            .insert(source_id.clone(), stop_signal.clone());

        on_status(source_id.clone(), "running".to_string());

        let (tx, rx) = mpsc::unbounded_channel::<LogEntry>();
        spawn_batch_emitter_task(rx, on_log_batch);
        spawn_file_watcher_task(
            self.clone(),
            source_id,
            file_path,
            stop_signal,
            tx,
            on_status,
        );

        Ok(())
    }

    pub async fn stop_watching(&self, source_id: &str) -> Result<(), String> {
        let stop = self.watchers.lock().await.remove(source_id);
        if let Some(stop) = stop {
            stop.store(true, Ordering::Relaxed);
        }
        Ok(())
    }

    async fn cleanup(&self, source_id: &str) {
        self.watchers.lock().await.remove(source_id);
    }
}

fn spawn_file_watcher_task(
    manager: FileLogManager,
    source_id: String,
    file_path: String,
    stop_signal: Arc<AtomicBool>,
    tx: mpsc::UnboundedSender<LogEntry>,
    on_status: StatusCallback,
) {
    tokio::spawn(async move {
        let mut initialized = false;
        let mut position = 0_u64;
        let mut pending_fragment = String::new();
        let mut pending_laravel_entry: Option<String> = None;
        let mut idle_ticks: u8 = 0;
        let mut missing_file_ticks: u8 = 0;
        let mut missing_status_emitted = false;

        while !stop_signal.load(Ordering::Relaxed) {
            match tokio::fs::metadata(&file_path).await {
                Ok(metadata) => {
                    missing_file_ticks = 0;
                    if missing_status_emitted {
                        on_status(source_id.clone(), "running".to_string());
                        missing_status_emitted = false;
                    }
                    if !initialized {
                        position = metadata.len().saturating_sub(INITIAL_READ_WINDOW_BYTES);
                        initialized = true;
                    }

                    if metadata.len() < position {
                        position = 0;
                        pending_fragment.clear();
                        pending_laravel_entry = None;
                    }

                    if metadata.len() > position {
                        idle_ticks = 0;
                        match read_new_bytes(&file_path, position).await {
                            Ok((bytes, next_position)) => {
                                position = next_position;
                                let chunk = String::from_utf8_lossy(&bytes);
                                let combined = format!("{pending_fragment}{chunk}");
                                let mut lines =
                                    combined.split('\n').map(ToString::to_string).collect::<Vec<_>>();
                                pending_fragment = lines.pop().unwrap_or_default();
                                for line in lines {
                                    let trimmed = line.trim_end_matches('\r');
                                    if trimmed.trim().is_empty() {
                                        continue;
                                    }
                                    if is_laravel_log_start(trimmed) {
                                        if let Some(previous_entry) =
                                            pending_laravel_entry.replace(trimmed.to_string())
                                        {
                                            let mut entry = parse_line(&previous_entry, &source_id);
                                            entry
                                                .fields
                                                .insert("log_file".to_string(), file_path.clone());
                                            if tx.send(entry).is_err() {
                                                break;
                                            }
                                        }
                                        continue;
                                    }

                                    if let Some(current_entry) = pending_laravel_entry.as_mut() {
                                        current_entry.push('\n');
                                        current_entry.push_str(trimmed);
                                        continue;
                                    }

                                    let mut entry = parse_line(trimmed, &source_id);
                                    entry
                                        .fields
                                        .insert("log_file".to_string(), file_path.clone());
                                    if tx.send(entry).is_err() {
                                        break;
                                    }
                                }
                            }
                            Err(error) => {
                                on_status(source_id.clone(), "error".to_string());
                                eprintln!("read file failed for {file_path}: {error}");
                                manager.cleanup(&source_id).await;
                                return;
                            }
                        }
                    } else {
                        idle_ticks = idle_ticks.saturating_add(1);
                        if idle_ticks >= IDLE_FLUSH_TICKS {
                            if !pending_fragment.trim().is_empty() {
                                let line = std::mem::take(&mut pending_fragment);
                                let trimmed = line.trim_end_matches('\r').trim();
                                if !trimmed.is_empty() {
                                    if is_laravel_log_start(trimmed) {
                                        if let Some(previous_entry) =
                                            pending_laravel_entry.replace(trimmed.to_string())
                                        {
                                            let mut entry = parse_line(&previous_entry, &source_id);
                                            entry
                                                .fields
                                                .insert("log_file".to_string(), file_path.clone());
                                            if tx.send(entry).is_err() {
                                                break;
                                            }
                                        }
                                    } else if let Some(current_entry) = pending_laravel_entry.as_mut() {
                                        current_entry.push('\n');
                                        current_entry.push_str(trimmed);
                                    } else {
                                        let mut entry = parse_line(trimmed, &source_id);
                                        entry
                                            .fields
                                            .insert("log_file".to_string(), file_path.clone());
                                        if tx.send(entry).is_err() {
                                            break;
                                        }
                                    }
                                }
                            }

                            if let Some(previous_entry) = pending_laravel_entry.take() {
                                let mut entry = parse_line(&previous_entry, &source_id);
                                entry
                                    .fields
                                    .insert("log_file".to_string(), file_path.clone());
                                if tx.send(entry).is_err() {
                                    break;
                                }
                            }
                            idle_ticks = 0;
                        }
                    }
                }
                Err(error) => {
                    initialized = false;
                    missing_file_ticks = missing_file_ticks.saturating_add(1);
                    if missing_file_ticks >= MISSING_FILE_ERROR_TICKS && !missing_status_emitted {
                        on_status(source_id.clone(), "error".to_string());
                        eprintln!(
                            "[file-log-debug] metadata missing for source_id={} file_path={} error={}",
                            source_id, file_path, error
                        );
                        missing_status_emitted = true;
                    }
                }
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }

        if let Some(previous_entry) = pending_laravel_entry.take() {
            let mut entry = parse_line(&previous_entry, &source_id);
            entry
                .fields
                .insert("log_file".to_string(), file_path.clone());
            let _ = tx.send(entry);
        }

        manager.cleanup(&source_id).await;
        on_status(source_id, "stopped".to_string());
    });
}

async fn read_new_bytes(file_path: &str, from: u64) -> Result<(Vec<u8>, u64), String> {
    let mut file = File::open(file_path)
        .await
        .map_err(|error| format!("open file failed: {error}"))?;
    file.seek(std::io::SeekFrom::Start(from))
        .await
        .map_err(|error| format!("seek file failed: {error}"))?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)
        .await
        .map_err(|error| format!("read file failed: {error}"))?;
    let len = bytes.len() as u64;
    Ok((bytes, from + len))
}

fn spawn_batch_emitter_task(mut rx: mpsc::UnboundedReceiver<LogEntry>, on_log_batch: LogBatchCallback) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_millis(EMIT_INTERVAL_MS));
        let mut pending: Vec<LogEntry> = Vec::with_capacity(200);
        loop {
            tokio::select! {
                maybe_entry = rx.recv() => {
                    match maybe_entry {
                        Some(entry) => {
                            pending.push(entry);
                            if pending.len() > MAX_PENDING_RECORDS {
                                let drain_count = pending.len() - MAX_PENDING_RECORDS;
                                pending.drain(..drain_count);
                            }
                            if pending.len() >= MAX_BATCH_SIZE {
                                on_log_batch(std::mem::take(&mut pending));
                            }
                        }
                        None => {
                            if !pending.is_empty() {
                                on_log_batch(std::mem::take(&mut pending));
                            }
                            break;
                        }
                    }
                }
                _ = interval.tick() => {
                    if !pending.is_empty() {
                        on_log_batch(std::mem::take(&mut pending));
                    }
                }
            }
        }
    });
}
