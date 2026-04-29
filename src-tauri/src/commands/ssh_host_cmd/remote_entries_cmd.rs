use std::sync::Arc;
use std::time::Duration;

use tokio::sync::Mutex;
use uuid::Uuid;

use crate::commands::ssh_host_cmd::common::{
    SshRemoteListResult, build_remote_list_script, build_ssh_launch_context, parse_remote_list_output,
    schedule_temp_key_cleanup,
};
use crate::core::ssh_host_store;
use crate::state::AppState;

#[tauri::command]
pub async fn list_ssh_remote_entries(
    host_id: String,
    path: String,
    state: tauri::State<'_, AppState>,
) -> Result<SshRemoteListResult, String> {
    let hosts = ssh_host_store::list_ssh_hosts()?;
    let host = hosts
        .iter()
        .find(|ssh_host| ssh_host.id == host_id)
        .ok_or_else(|| format!("SSH host not found: {host_id}"))?
        .clone();
    let launch_context = build_ssh_launch_context(&host)?;
    let target_path = if path.trim().is_empty() {
        host.log_path.unwrap_or_else(|| "~".to_string())
    } else {
        path.trim().to_string()
    };

    let tab_id = format!("ssh-log-browse-{}", Uuid::new_v4());
    let output_buffer = Arc::new(Mutex::new(String::new()));
    let output_buffer_for_callback = Arc::clone(&output_buffer);
    let on_output = Arc::new(move |chunk: Vec<u8>| {
        let output_text = String::from_utf8_lossy(&chunk);
        if let Ok(mut buffer) = output_buffer_for_callback.try_lock() {
            buffer.push_str(&output_text);
        }
    });
    let (exit_tx, exit_rx) = tokio::sync::oneshot::channel::<String>();
    let exit_tx = Arc::new(std::sync::Mutex::new(Some(exit_tx)));
    let on_exit = Arc::new(move |reason: String| {
        if let Ok(mut sender) = exit_tx.lock() {
            if let Some(tx) = sender.take() {
                let _ = tx.send(reason);
            }
        }
    });

    let mut ssh_args = launch_context.ssh_args;
    ssh_args.insert(0, "-T".to_string());
    ssh_args.push(build_remote_list_script(&target_path));
    let instance_id = state
        .pty_manager
        .open_pty(
            tab_id.clone(),
            ".".into(),
            Some("ssh".into()),
            ssh_args,
            vec![],
            launch_context.auto_password.clone(),
            120,
            40,
            on_output,
            on_exit,
        )
        .await?;
    schedule_temp_key_cleanup(launch_context.temp_paths);

    let _ = tokio::time::timeout(Duration::from_secs(15), exit_rx)
        .await
        .map_err(|_| "SSH list command timed out".to_string())?;
    let _ = state.pty_manager.close_pty(&tab_id, &instance_id).await;

    let output = output_buffer.lock().await.clone();
    let mut entries = parse_remote_list_output(&output);
    entries.sort_by(|left_entry, right_entry| {
        right_entry
            .is_dir
            .cmp(&left_entry.is_dir)
            .then_with(|| left_entry.name.to_lowercase().cmp(&right_entry.name.to_lowercase()))
    });
    Ok(SshRemoteListResult {
        base_path: target_path,
        entries,
    })
}
