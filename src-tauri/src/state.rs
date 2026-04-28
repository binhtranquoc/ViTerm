use crate::core::file_log_manager::FileLogManager;
use crate::core::process_manager::ProcessManager;
use crate::core::pty_manager::PtyManager;

#[derive(Default)]
pub struct AppState {
    pub file_log_manager: FileLogManager,
    pub process_manager: ProcessManager,
    pub pty_manager: PtyManager,
}
