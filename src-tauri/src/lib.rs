pub mod app;
pub mod features;
pub mod shared;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(app::state::AppState::default())
        .invoke_handler(tauri::generate_handler![
            shared::commands::app_lifecycle_cmd::mark_app_ready,
            shared::commands::clipboard_cmd::write_clipboard_text,
            features::log_viewer::commands::file_log_cmd::start_file_log_stream,
            features::log_viewer::commands::file_log_cmd::start_file_log_streams,
            features::log_viewer::commands::file_log_cmd::stop_file_log_stream,
            features::log_viewer::commands::file_log_cmd::stop_file_log_streams,
            features::log_viewer::commands::stdout_log_cmd::spawn_process,
            features::log_viewer::commands::stdout_log_cmd::stop_process,
            features::log_viewer::commands::stdout_log_cmd::send_process_input,
            features::log_viewer::commands::stdout_log_cmd::pause_process,
            features::log_viewer::commands::stdout_log_cmd::resume_process,
            features::terminal::commands::pty_cmd::open_pty,
            features::terminal::commands::pty_cmd::write_pty,
            features::terminal::commands::pty_cmd::resize_pty,
            features::terminal::commands::pty_cmd::close_pty,
            features::terminal::commands::pty_cmd::force_close_pty_tab,
            features::host::commands::ssh_host_cmd::list_ssh_hosts,
            features::host::commands::ssh_host_cmd::list_ssh_groups,
            features::host::commands::ssh_host_cmd::create_ssh_host,
            features::host::commands::ssh_host_cmd::update_ssh_host,
            features::host::commands::ssh_host_cmd::delete_ssh_host,
            features::host::commands::ssh_host_cmd::get_ssh_host_secrets,
            features::host::commands::ssh_remote_cmd::list_ssh_remote_entries,
            features::log_viewer::commands::ssh_file_log_cmd::start_ssh_file_log_streams,
            features::log_viewer::commands::ssh_file_log_cmd::stop_ssh_file_log_streams,
            features::log_viewer::commands::ssh_file_log_cmd::update_ssh_file_log_paths,
            features::host::commands::ssh_terminal_cmd::open_ssh_host_terminal,
            features::host::commands::ssh_terminal_cmd::stop_ssh_host_terminal,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
