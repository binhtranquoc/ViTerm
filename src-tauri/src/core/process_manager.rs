use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{Mutex, mpsc};

use crate::core::log_parser::parse_line;
use crate::models::log_entry::{LogEntry, LogParserType};

type SharedChild = Arc<Mutex<Child>>;
type LogBatchCallback = Arc<dyn Fn(Vec<LogEntry>) + Send + Sync>;
type StatusCallback = Arc<dyn Fn(String, String) + Send + Sync>;
const MAX_BATCH_SIZE: usize = 50;
const MAX_PENDING_RECORDS: usize = 1000;
const EMIT_INTERVAL_MS: u64 = 100;

#[derive(Clone)]
struct ManagedProcess {
    child: SharedChild,
    paused: Arc<AtomicBool>,
}

#[derive(Clone, Default)]
pub struct ProcessManager {
    processes: Arc<Mutex<HashMap<String, ManagedProcess>>>,
}

impl ProcessManager {
    pub async fn spawn_process(
        &self,
        source_id: String,
        command: String,
        cwd: String,
        json_only: bool,
        on_log_batch: LogBatchCallback,
        on_status: StatusCallback,
    ) -> Result<(), String> {
        let mut child = build_shell_command(&command, &cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| format!("spawn process failed: {error}"))?;

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "cannot read stdout pipe".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "cannot read stderr pipe".to_string())?;

        let child_handle = Arc::new(Mutex::new(child));
        let paused = Arc::new(AtomicBool::new(false));
        let managed = ManagedProcess {
            child: child_handle.clone(),
            paused: paused.clone(),
        };
        self.processes
            .lock()
            .await
            .insert(source_id.clone(), managed);

        on_status(source_id.clone(), "running".to_string());

        let (tx, rx) = mpsc::unbounded_channel::<LogEntry>();
        spawn_reader_task(stdout, source_id.clone(), paused.clone(), tx.clone(), json_only);
        spawn_reader_task(stderr, source_id.clone(), paused, tx, json_only);
        spawn_batch_emitter_task(rx, on_log_batch);
        spawn_waiter_task(
            self.clone(),
            child_handle,
            source_id,
            on_status,
        );

        Ok(())
    }

    pub async fn stop_process(&self, source_id: &str) -> Result<(), String> {
        let process = self.processes.lock().await.remove(source_id);
        if let Some(process) = process {
            process
                .child
                .lock()
                .await
                .kill()
                .await
                .map_err(|error| format!("kill process failed: {error}"))?;
        }
        Ok(())
    }

    pub async fn send_input(
        &self,
        source_id: &str,
        input: &str,
        append_newline: bool,
    ) -> Result<(), String> {
        let process = self
            .processes
            .lock()
            .await
            .get(source_id)
            .map(|managed| managed.child.clone())
            .ok_or_else(|| format!("process not found for source_id={source_id}"))?;

        let mut child = process.lock().await;
        let stdin = child
            .stdin
            .as_mut()
            .ok_or_else(|| "stdin is not available".to_string())?;

        stdin
            .write_all(input.as_bytes())
            .await
            .map_err(|error| format!("write stdin failed: {error}"))?;

        if append_newline {
            stdin
                .write_all(b"\n")
                .await
                .map_err(|error| format!("write newline failed: {error}"))?;
        }

        stdin
            .flush()
            .await
            .map_err(|error| format!("flush stdin failed: {error}"))?;

        Ok(())
    }

    async fn cleanup(&self, source_id: &str) {
        self.processes.lock().await.remove(source_id);
    }

    pub async fn pause_process(&self, source_id: &str) -> Result<(), String> {
        let process = self
            .processes
            .lock()
            .await
            .get(source_id)
            .cloned()
            .ok_or_else(|| format!("process not found for source_id={source_id}"))?;
        process.paused.store(true, Ordering::Relaxed);
        Ok(())
    }

    pub async fn resume_process(&self, source_id: &str) -> Result<(), String> {
        let process = self
            .processes
            .lock()
            .await
            .get(source_id)
            .cloned()
            .ok_or_else(|| format!("process not found for source_id={source_id}"))?;
        process.paused.store(false, Ordering::Relaxed);
        Ok(())
    }
}

fn spawn_reader_task<T>(
    stream: T,
    source_id: String,
    paused: Arc<AtomicBool>,
    tx: mpsc::UnboundedSender<LogEntry>,
    json_only: bool,
)
where
    T: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        let mut lines = BufReader::new(stream).lines();
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    if paused.load(Ordering::Relaxed) {
                        continue;
                    }
                    let entry = parse_line(&line, &source_id);
                    if json_only && entry.parser_type != LogParserType::Json {
                        continue;
                    }
                    if tx.send(entry).is_err() {
                        break;
                    }
                }
                Ok(None) => break,
                Err(_) => break,
            }
        }
    });
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

fn spawn_waiter_task(
    manager: ProcessManager,
    child_handle: SharedChild,
    source_id: String,
    on_status: StatusCallback,
) {
    tokio::spawn(async move {
        let status = child_handle.lock().await.wait().await;
        manager.cleanup(&source_id).await;

        let next_status = match status {
            Ok(exit) if exit.success() => "stopped",
            Ok(_) => "error",
            Err(_) => "error",
        };
        on_status(source_id, next_status.to_string());
    });
}

fn build_shell_command(command: &str, cwd: &str) -> Command {
    let mut process = Command::new("sh");
    process.arg("-c").arg(command).current_dir(cwd);
    process
}
