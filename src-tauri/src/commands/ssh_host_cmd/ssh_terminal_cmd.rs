use std::sync::Arc;
use std::time::Duration;

use crate::commands::pty_cmd::make_pty_output_callback;
use crate::commands::ssh_host_cmd::common::{
    SSH_MAX_RETRIES, build_ssh_launch_context, emit_ssh_state, schedule_temp_key_cleanup,
};
use crate::core::ssh_host_store;
use crate::state::AppState;

/// Opens a PTY session connected to an SSH process for the given saved host.
/// Returns the instance_id so the frontend can pass it back to `close_pty`
/// and avoid stale React cleanups killing the wrong session.
#[tauri::command]
pub async fn open_ssh_host_terminal(
    host_id: String,
    tab_id: String,
    cols: u16,
    rows: u16,
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    state.ssh_session_manager.cancel_session(&tab_id).await;
    let mut cancel_rx = state.ssh_session_manager.start_session(tab_id.clone()).await;

    let hosts = ssh_host_store::list_ssh_hosts()?;
    let host = hosts
        .iter()
        .find(|ssh_host| ssh_host.id == host_id)
        .ok_or_else(|| format!("SSH host not found: {host_id}"))?
        .clone();

    let launch_context = build_ssh_launch_context(&host)?;
    schedule_temp_key_cleanup(launch_context.temp_paths);

    emit_ssh_state(&app_handle, &tab_id, &host.id, "connecting", 0, None, None);

    let on_output = make_pty_output_callback(app_handle.clone(), tab_id.clone());
    let (exit_tx, mut exit_rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    let exit_tx_on_first = exit_tx.clone();
    let on_exit = Arc::new(move |reason: String| {
        let _ = exit_tx_on_first.send(reason);
    });

    let instance_id = state
        .pty_manager
        .open_pty(
            tab_id.clone(),
            ".".into(),
            Some("ssh".into()),
            launch_context.ssh_args,
            vec![],
            launch_context.auto_password,
            cols,
            rows,
            on_output,
            on_exit,
        )
        .await?;
    emit_ssh_state(
        &app_handle,
        &tab_id,
        &host.id,
        "connected",
        0,
        Some(instance_id.clone()),
        None,
    );

    let pty_manager = state.pty_manager.clone();
    let ssh_session_manager = state.ssh_session_manager.clone();
    let app_handle_for_task = app_handle.clone();
    let tab_id_for_task = tab_id.clone();
    let host_id_for_task = host.id.clone();
    let exit_tx_for_task = exit_tx.clone();
    tokio::spawn(async move {
        let mut attempt = 0_u32;
        loop {
            tokio::select! {
                _ = cancel_rx.changed() => {
                    break;
                }
                maybe_reason = exit_rx.recv() => {
                    let reason = maybe_reason.unwrap_or_else(|| "ssh session closed".to_string());
                    if !ssh_session_manager.is_session_active(&tab_id_for_task).await {
                        break;
                    }

                    emit_ssh_state(
                        &app_handle_for_task,
                        &tab_id_for_task,
                        &host_id_for_task,
                        "disconnected",
                        attempt,
                        None,
                        Some(reason),
                    );

                    if attempt >= SSH_MAX_RETRIES {
                        emit_ssh_state(
                            &app_handle_for_task,
                            &tab_id_for_task,
                            &host_id_for_task,
                            "dead",
                            attempt,
                            None,
                            Some("max reconnect attempts reached".to_string()),
                        );
                        ssh_session_manager.cancel_session(&tab_id_for_task).await;
                        break;
                    }

                    attempt += 1;
                    emit_ssh_state(
                        &app_handle_for_task,
                        &tab_id_for_task,
                        &host_id_for_task,
                        "reconnecting",
                        attempt,
                        None,
                        None,
                    );

                    let wait_secs = (2_u64.pow(attempt.min(5))).min(30);
                    tokio::select! {
                        _ = cancel_rx.changed() => break,
                        _ = tokio::time::sleep(Duration::from_secs(wait_secs)) => {}
                    }

                    let host_list = match ssh_host_store::list_ssh_hosts() {
                        Ok(value) => value,
                        Err(error) => {
                            emit_ssh_state(
                                &app_handle_for_task,
                                &tab_id_for_task,
                                &host_id_for_task,
                                "dead",
                                attempt,
                                None,
                                Some(error),
                            );
                            ssh_session_manager.cancel_session(&tab_id_for_task).await;
                            break;
                        }
                    };
                    let latest_host = match host_list.iter().find(|ssh_host| ssh_host.id == host_id_for_task) {
                        Some(value) => value.clone(),
                        None => {
                            emit_ssh_state(
                                &app_handle_for_task,
                                &tab_id_for_task,
                                &host_id_for_task,
                                "dead",
                                attempt,
                                None,
                                Some("ssh host was deleted".to_string()),
                            );
                            ssh_session_manager.cancel_session(&tab_id_for_task).await;
                            break;
                        }
                    };
                    let launch_context = match build_ssh_launch_context(&latest_host) {
                        Ok(value) => value,
                        Err(error) => {
                            emit_ssh_state(
                                &app_handle_for_task,
                                &tab_id_for_task,
                                &host_id_for_task,
                                "dead",
                                attempt,
                                None,
                                Some(error),
                            );
                            ssh_session_manager.cancel_session(&tab_id_for_task).await;
                            break;
                        }
                    };
                    schedule_temp_key_cleanup(launch_context.temp_paths);

                    let on_output = make_pty_output_callback(app_handle_for_task.clone(), tab_id_for_task.clone());
                    let exit_tx_retry = exit_tx_for_task.clone();
                    let on_exit = Arc::new(move |reason: String| {
                        let _ = exit_tx_retry.send(reason);
                    });
                    match pty_manager.open_pty(
                        tab_id_for_task.clone(),
                        ".".into(),
                        Some("ssh".into()),
                        launch_context.ssh_args,
                        vec![],
                        launch_context.auto_password,
                        cols,
                        rows,
                        on_output,
                        on_exit,
                    ).await {
                        Ok(next_instance) => {
                            attempt = 0;
                            emit_ssh_state(
                                &app_handle_for_task,
                                &tab_id_for_task,
                                &host_id_for_task,
                                "connected",
                                attempt,
                                Some(next_instance),
                                None,
                            );
                        }
                        Err(error) => {
                            emit_ssh_state(
                                &app_handle_for_task,
                                &tab_id_for_task,
                                &host_id_for_task,
                                "connect_failed",
                                attempt,
                                None,
                                Some(error),
                            );
                        }
                    }
                }
            }
        }
    });

    Ok(instance_id)
}

#[tauri::command]
pub async fn stop_ssh_host_terminal(
    tab_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    state.ssh_session_manager.cancel_session(&tab_id).await;
    Ok(())
}
