pub mod commands;
pub mod core;
pub mod models;
pub mod state;
pub mod utils;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(state::AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::clipboard_cmd::write_clipboard_text,
            commands::file_log_cmd::start_file_log_stream,
            commands::file_log_cmd::start_file_log_streams,
            commands::file_log_cmd::stop_file_log_stream,
            commands::file_log_cmd::stop_file_log_streams,
            commands::process_cmd::spawn_process,
            commands::process_cmd::stop_process,
            commands::process_cmd::send_process_input,
            commands::process_cmd::pause_process,
            commands::process_cmd::resume_process,
            commands::pty_cmd::open_pty,
            commands::pty_cmd::write_pty,
            commands::pty_cmd::resize_pty,
            commands::pty_cmd::close_pty,
            commands::pty_cmd::force_close_pty_tab,
            commands::ssh_host_cmd::host_crud_cmd::list_ssh_hosts,
            commands::ssh_host_cmd::host_crud_cmd::list_ssh_groups,
            commands::ssh_host_cmd::host_crud_cmd::create_ssh_host,
            commands::ssh_host_cmd::host_crud_cmd::update_ssh_host,
            commands::ssh_host_cmd::host_crud_cmd::delete_ssh_host,
            commands::ssh_host_cmd::host_crud_cmd::get_ssh_host_secrets,
            commands::ssh_host_cmd::remote_entries_cmd::list_ssh_remote_entries,
            commands::ssh_host_cmd::ssh_file_log_cmd::start_ssh_file_log_streams,
            commands::ssh_host_cmd::ssh_file_log_cmd::stop_ssh_file_log_streams,
            commands::ssh_host_cmd::ssh_file_log_cmd::update_ssh_file_log_paths,
            commands::ssh_host_cmd::ssh_terminal_cmd::open_ssh_host_terminal,
            commands::ssh_host_cmd::ssh_terminal_cmd::stop_ssh_host_terminal,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
