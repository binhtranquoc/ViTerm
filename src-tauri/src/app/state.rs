use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::AtomicBool;

use tokio::sync::Mutex;

use crate::features::host::core::ssh_session_manager::SshSessionManager;
use crate::features::log_viewer::core::file_log::watcher::FileLogManager;
use crate::features::log_viewer::core::stdout_log::manager::ProcessManager;
use crate::features::terminal::core::pty_manager::PtyManager;

#[derive(Default)]
pub struct AppState {
    pub file_log_manager: FileLogManager,
    pub file_log_groups: Mutex<HashMap<String, Vec<String>>>,
    pub ssh_file_log_sessions: Mutex<HashMap<String, (String, String, Arc<AtomicBool>)>>,
    pub process_manager: ProcessManager,
    pub pty_manager: PtyManager,
    pub ssh_session_manager: SshSessionManager,
}
