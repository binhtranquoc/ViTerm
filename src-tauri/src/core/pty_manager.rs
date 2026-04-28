use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;

use portable_pty::{native_pty_system, CommandBuilder, PtySize};

struct PtySession {
    /// Unique ID per open_pty call — used to guard against stale cleanups
    /// that arrive after a newer session has been opened with the same tab_id.
    instance_id: String,
    writer: Arc<std::sync::Mutex<Box<dyn Write + Send>>>,
    master: Arc<std::sync::Mutex<Box<dyn portable_pty::MasterPty + Send>>>,
    child: Arc<std::sync::Mutex<Box<dyn portable_pty::Child + Send + Sync>>>,
}

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

        // Background thread: pump PTY output → callback, and auto-inject password
        // when SSH prompts for credentials. We may need more than one injection
        // (e.g. prompt appears again after transient auth negotiation), so allow
        // a few attempts instead of only one.
        let writer_for_auto_input = Arc::clone(&writer);
        std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            let mut injected_password_count = 0usize;
            let mut recent_output = String::new();
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let chunk = &buf[..n];
                        on_output(chunk.to_vec());

                        if let Some(ref password) = auto_password {
                            if !password.is_empty() && injected_password_count < 3 {
                                recent_output.push_str(&String::from_utf8_lossy(chunk));
                                if recent_output.len() > 2048 {
                                    let drain = recent_output.len() - 2048;
                                    recent_output.drain(..drain);
                                }
                                let lower = recent_output.to_lowercase();
                                let asked_credential = lower.contains("password:")
                                    || lower.contains("passphrase")
                                    || lower.contains("verification code:");
                                if asked_credential {
                                    let mut guard = writer_for_auto_input.lock().unwrap();
                                    let _ = guard.write_all(format!("{password}\n").as_bytes());
                                    injected_password_count += 1;
                                    recent_output.clear();
                                }
                            }
                        }
                    }
                }
            }
        });

        // If a session with the same tab_id already exists, kill it first.
        if let Some(old) = self.sessions.lock().await.insert(
            tab_id,
            PtySession { instance_id: instance_id.clone(), writer, master, child },
        ) {
            let _ = old.child.lock().unwrap().kill();
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
        let mut guard = writer.lock().unwrap();
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
        let guard = master.lock().unwrap();
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
                let _ = session.child.lock().unwrap().kill();
            }
        }
        Ok(())
    }
}
