use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;
use tokio::sync::Mutex;

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde_json::Value;

struct PtySession {
    /// Unique ID per open_pty call — used to guard against stale cleanups
    /// that arrive after a newer session has been opened with the same tab_id.
    instance_id: String,
    writer: Arc<std::sync::Mutex<Box<dyn Write + Send>>>,
    master: Arc<std::sync::Mutex<Box<dyn portable_pty::MasterPty + Send>>>,
    child: Arc<std::sync::Mutex<Box<dyn portable_pty::Child + Send + Sync>>>,
}

const OUTPUT_FLUSH_INTERVAL_MS: u64 = 16;
const OUTPUT_MAX_PENDING_BYTES: usize = 4 * 1024 * 1024;
const OUTPUT_MAX_BATCH_BYTES: usize = 256 * 1024;

#[derive(Clone, Default)]
pub struct PtyManager {
    sessions: Arc<Mutex<HashMap<String, PtySession>>>,
}

impl PtyManager {
    fn resolve_home_dir() -> Option<PathBuf> {
        #[cfg(windows)]
        {
            if let Ok(profile) = std::env::var("USERPROFILE") {
                if !profile.trim().is_empty() {
                    return Some(PathBuf::from(profile));
                }
            }

            let drive = std::env::var("HOMEDRIVE").unwrap_or_default();
            let path = std::env::var("HOMEPATH").unwrap_or_default();
            if !drive.is_empty() && !path.is_empty() {
                return Some(PathBuf::from(format!("{drive}{path}")));
            }
        }

        #[cfg(not(windows))]
        {
            if let Ok(home) = std::env::var("HOME") {
                if !home.trim().is_empty() {
                    return Some(PathBuf::from(home));
                }
            }
        }

        std::env::current_dir().ok()
    }

    fn resolve_cwd(cwd: &str) -> String {
        let home = Self::resolve_home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .to_string_lossy()
            .to_string();
        let trimmed = cwd.trim();

        if trimmed.is_empty() || trimmed == "~" {
            return home;
        }

        if let Some(rest) = trimmed
            .strip_prefix("~/")
            .or_else(|| trimmed.strip_prefix("~\\"))
        {
            return PathBuf::from(&home).join(rest).to_string_lossy().to_string();
        }

        trimmed.to_string()
    }

    /// Opens a PTY session. Returns the instance_id that the caller must store
    /// and pass back to `close_pty` so that stale React cleanups don't kill
    /// a session that was opened by a later mount.
    pub async fn open_pty(
        &self,
        tab_id: String,
        cwd: String,
        program: Option<String>,
        args: Vec<String>,
        extra_env: Vec<(String, String)>,
        auto_password: Option<String>,
        cols: u16,
        rows: u16,
        on_output: Arc<dyn Fn(Vec<u8>) + Send + Sync + 'static>,
        on_exit: Arc<dyn Fn(String) + Send + Sync + 'static>,
    ) -> Result<String, String> {
        let instance_id = uuid::Uuid::new_v4().to_string();

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| e.to_string())?;

        let executable = program
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| std::env::var("SHELL").unwrap_or_else(|_| "zsh".to_string()));
        let mut cmd = CommandBuilder::new(executable);
        for arg in args { cmd.arg(arg); }
        let resolved_cwd = Self::resolve_cwd(&cwd);
        cmd.cwd(&resolved_cwd);
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        for (key, value) in extra_env { cmd.env(key, value); }

        let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;

        let writer = Arc::new(std::sync::Mutex::new(writer));
        let master = Arc::new(std::sync::Mutex::new(pair.master));
        let child = Arc::new(std::sync::Mutex::new(child));
        let (output_tx, mut output_rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
        let pending_output_bytes = Arc::new(AtomicUsize::new(0));

        let on_output_for_async = Arc::clone(&on_output);
        let pending_for_async = Arc::clone(&pending_output_bytes);
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_millis(OUTPUT_FLUSH_INTERVAL_MS));
            let mut pending_chunk = Vec::with_capacity(8192);
            loop {
                tokio::select! {
                    maybe_chunk = output_rx.recv() => {
                        match maybe_chunk {
                            Some(chunk) => {
                                pending_for_async.fetch_sub(chunk.len(), Ordering::Relaxed);
                                if pending_chunk.len() + chunk.len() > OUTPUT_MAX_BATCH_BYTES && !pending_chunk.is_empty() {
                                    on_output_for_async(std::mem::take(&mut pending_chunk));
                                }
                                pending_chunk.extend_from_slice(&chunk);
                                if pending_chunk.len() >= OUTPUT_MAX_BATCH_BYTES {
                                    on_output_for_async(std::mem::take(&mut pending_chunk));
                                }
                            }
                            None => {
                                if !pending_chunk.is_empty() {
                                    on_output_for_async(std::mem::take(&mut pending_chunk));
                                }
                                break;
                            }
                        }
                    }
                    _ = interval.tick() => {
                        if !pending_chunk.is_empty() {
                            on_output_for_async(std::mem::take(&mut pending_chunk));
                        }
                    }
                }
            }
        });

        // Background thread: pump PTY output → callback, and auto-inject password
        // when SSH prompts for credentials. We may need more than one injection
        // (e.g. prompt appears again after transient auth negotiation), so allow
        // a few attempts instead of only one.
        let writer_for_auto_input = Arc::clone(&writer);
        std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            let mut injected_password_count = 0usize;
            let mut recent_output = String::new();
            let mut exit_reason = String::from("pty stream closed");
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Err(error) => {
                        exit_reason = error.to_string();
                        break;
                    }
                    Ok(n) => {
                        let chunk = &buf[..n];
                        let buffered = pending_output_bytes.fetch_add(chunk.len(), Ordering::Relaxed) + chunk.len();
                        if buffered <= OUTPUT_MAX_PENDING_BYTES {
                            if output_tx.send(chunk.to_vec()).is_err() {
                                pending_output_bytes.fetch_sub(chunk.len(), Ordering::Relaxed);
                                break;
                            }
                        } else {
                            pending_output_bytes.fetch_sub(chunk.len(), Ordering::Relaxed);
                        }

                        if let Some(ref password) = auto_password {
                            // Allow more injection attempts for interactive prompts.
                            if !password.is_empty() && injected_password_count < 6 {
                                recent_output.push_str(&String::from_utf8_lossy(chunk));
                                if recent_output.len() > 2048 {
                                    let drain = recent_output.len() - 2048;
                                    recent_output.drain(..drain);
                                }
                                let lower = recent_output.to_lowercase();
                                let asked_for_passphrase = lower.contains("passphrase");
                                let asked_for_password = lower.contains("password:")
                                    || (lower.contains("password") && lower.contains(":"));
                                let asked_for_verification = lower.contains("verification code:");
                                let asked_credential = asked_for_passphrase
                                    || asked_for_password
                                    || asked_for_verification;
                                if asked_credential {
                                    if let Ok(mut guard) = writer_for_auto_input.lock() {
                                        const AUTO_SECRETS_PREFIX: &str = "__SSH_AUTO_SECRETS__";
                                        let secret_to_send = if password.starts_with(AUTO_SECRETS_PREFIX) {
                                            let json_part = &password[AUTO_SECRETS_PREFIX.len()..];
                                            let decoded: Value = serde_json::from_str(json_part).unwrap_or(Value::Null);
                                            let passphrase = decoded
                                                .get("passphrase")
                                                .and_then(|v| v.as_str())
                                                .unwrap_or("");
                                            let account_password = decoded
                                                .get("password")
                                                .and_then(|v| v.as_str())
                                                .unwrap_or("");
                                            if asked_for_passphrase {
                                                passphrase.to_string()
                                            } else {
                                                account_password.to_string()
                                            }
                                        } else {
                                            password.clone()
                                        };

                                        if secret_to_send.is_empty() {
                                            // If we don't have the correct secret for this prompt type, don't spam.
                                            eprintln!(
                                                "[pty-auto-input] credential prompt detected: asked_for_passphrase={} asked_for_password={} asked_for_verification={}. but secret_to_send is empty",
                                                asked_for_passphrase,
                                                asked_for_password,
                                                asked_for_verification
                                            );
                                            recent_output.clear();
                                            continue;
                                        }

                                        let prompt_count = if asked_for_verification {
                                            lower.matches("verification code:").count()
                                        } else if asked_for_passphrase {
                                            lower.matches("passphrase").count()
                                        } else if asked_for_password {
                                            // For ssh-style prompts like "root@host's password:"
                                            lower.matches("password:").count()
                                        } else {
                                            1usize
                                        }
                                        .max(1);

                                        let remaining = 6usize.saturating_sub(injected_password_count);
                                        let to_inject = prompt_count.min(remaining).max(1);

                                        eprintln!(
                                            "[pty-auto-input] credential prompt detected: asked_for_passphrase={} asked_for_password={} asked_for_verification={} -> injecting {} x{}",
                                            asked_for_passphrase,
                                            asked_for_password,
                                            asked_for_verification,
                                            if password.starts_with("__SSH_AUTO_SECRETS__") {
                                                if asked_for_passphrase { "passphrase" } else { "password" }
                                            } else {
                                                "password"
                                            },
                                            to_inject
                                        );

                                        // Many SSH servers expect CRLF for password entry.
                                        for _ in 0..to_inject {
                                            let _ = guard.write_all(secret_to_send.as_bytes());
                                            let _ = guard.write_all(b"\r\n");
                                            injected_password_count += 1;
                                        }
                                        recent_output.clear();
                                    }
                                }
                            }
                        }
                    }
                }
            }
            on_exit(exit_reason);
        });

        // If a session with the same tab_id already exists, kill it first.
        if let Some(old) = self.sessions.lock().await.insert(
            tab_id,
            PtySession { instance_id: instance_id.clone(), writer, master, child },
        ) {
            if let Ok(mut child_guard) = old.child.lock() {
                let _ = child_guard.kill();
            }
        }

        Ok(instance_id)
    }

    pub async fn write_pty(&self, tab_id: &str, data: &[u8]) -> Result<(), String> {
        let writer = {
            let sessions = self.sessions.lock().await;
            match sessions.get(tab_id) {
                Some(session) => Arc::clone(&session.writer),
                None => return Ok(()), // session already closed
            }
        };
        let mut guard = writer
            .lock()
            .map_err(|_| "failed to lock PTY writer".to_string())?;
        match guard.write_all(data) {
            Ok(()) => Ok(()),
            Err(e) if e.raw_os_error() == Some(5) => Ok(()), // EIO: child exited
            Err(e) => Err(e.to_string()),
        }
    }

    pub async fn resize_pty(&self, tab_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let master = {
            let sessions = self.sessions.lock().await;
            match sessions.get(tab_id) {
                Some(session) => Arc::clone(&session.master),
                None => return Ok(()), // session closed between resize events
            }
        };
        let guard = master
            .lock()
            .map_err(|_| "failed to lock PTY master".to_string())?;
        guard.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| e.to_string())
    }

    /// Closes a PTY session only if its instance_id matches, preventing stale
    /// React StrictMode cleanups from killing a session opened by a later mount.
    pub async fn close_pty(&self, tab_id: &str, instance_id: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().await;
        let matches = sessions.get(tab_id)
            .map(|s| s.instance_id == instance_id)
            .unwrap_or(false);
        if matches {
            if let Some(session) = sessions.remove(tab_id) {
                if let Ok(mut child_guard) = session.child.lock() {
                    let _ = child_guard.kill();
                }
            }
        }
        Ok(())
    }

    pub async fn close_tab_session(&self, tab_id: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().await;
        if let Some(session) = sessions.remove(tab_id) {
            if let Ok(mut child_guard) = session.child.lock() {
                let _ = child_guard.kill();
            }
        }
        Ok(())
    }
}
