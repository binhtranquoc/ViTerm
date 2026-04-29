use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::AtomicBool;

use tokio::sync::Mutex;

use crate::core::file_log_manager::FileLogManager;
use crate::core::process_manager::ProcessManager;
use crate::core::pty_manager::PtyManager;
use crate::core::ssh_session_manager::SshSessionManager;

#[derive(Default)]
pub struct AppState {
    pub file_log_manager: FileLogManager,
    pub file_log_groups: Mutex<HashMap<String, Vec<String>>>,
    pub ssh_file_log_sessions: Mutex<HashMap<String, (String, String, Arc<AtomicBool>)>>,
    pub process_manager: ProcessManager,
    pub pty_manager: PtyManager,
    pub ssh_session_manager: SshSessionManager,
}
