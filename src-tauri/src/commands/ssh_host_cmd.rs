use std::os::unix::fs::PermissionsExt;
use std::sync::Arc;

use uuid::Uuid;

use crate::commands::pty_cmd::make_pty_output_callback;
use crate::core::ssh_host_store;
use crate::models::ssh_host::{CreateSshHostPayload, SshHost, SshHostSecrets, UpdateSshHostPayload};
use crate::state::AppState;

// ── helpers ──────────────────────────────────────────────────────────────────

/// Writes a private key to a temp file with restricted permissions (0600).
fn write_temp_key(key_content: &str) -> Result<std::path::PathBuf, String> {
    let id = Uuid::new_v4().to_string();
    let path = std::env::temp_dir().join(format!("qbase_key_{id}"));
    std::fs::write(&path, key_content).map_err(|e| e.to_string())?;
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))
        .map_err(|e| e.to_string())?;
    Ok(path)
}

// ── tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn list_ssh_hosts() -> Result<Vec<SshHost>, String> {
    ssh_host_store::list_ssh_hosts()
}

#[tauri::command]
pub async fn list_ssh_groups() -> Result<Vec<String>, String> {
    ssh_host_store::list_ssh_groups()
}

#[tauri::command]
pub async fn create_ssh_host(payload: CreateSshHostPayload) -> Result<SshHost, String> {
    ssh_host_store::create_ssh_host(payload)
}

#[tauri::command]
pub async fn update_ssh_host(id: String, payload: UpdateSshHostPayload) -> Result<SshHost, String> {
    ssh_host_store::update_ssh_host(&id, payload)
}

#[tauri::command]
pub async fn delete_ssh_host(id: String) -> Result<(), String> {
    ssh_host_store::delete_ssh_host(&id)
}

#[tauri::command]
pub async fn get_ssh_host_secrets(id: String) -> Result<SshHostSecrets, String> {
    Ok(SshHostSecrets {
        password: ssh_host_store::read_sensitive_field(&id, "password")?,
        private_key: ssh_host_store::read_sensitive_field(&id, "private-key")?,
        passphrase: ssh_host_store::read_sensitive_field(&id, "passphrase")?,
    })
}

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
    let hosts = ssh_host_store::list_ssh_hosts()?;
    let host = hosts
        .iter()
        .find(|h| h.id == host_id)
        .ok_or_else(|| format!("SSH host not found: {host_id}"))?
        .clone();

    let mut ssh_args: Vec<String> = vec![
        // Accept the host key on first connection without prompting
        "-o".into(),
        "StrictHostKeyChecking=accept-new".into(),
        "-o".into(),
        "ConnectTimeout=12".into(),
        "-p".into(),
        host.port.to_string(),
    ];

    let extra_env: Vec<(String, String)> = vec![];
    let mut temp_paths: Vec<std::path::PathBuf> = vec![];
    let mut auto_password: Option<String> = None;

    if host.auth_type == "private_key" {
        if let Some(key_content) =
            ssh_host_store::read_sensitive_field(&host.id, "private-key")?
        {
            let key_path = write_temp_key(&key_content)?;
            ssh_args.push("-i".into());
            ssh_args.push(key_path.to_string_lossy().into_owned());
            temp_paths.push(key_path);
        }

        if let Some(passphrase) = ssh_host_store::read_sensitive_field(&host.id, "passphrase")? {
            if !passphrase.is_empty() {
                auto_password = Some(passphrase);
            }
        }
    } else {
        // Force password mode for password-auth hosts so OpenSSH doesn't try keys first.
        ssh_args.push("-o".into());
        ssh_args.push("PreferredAuthentications=password,keyboard-interactive".into());
        ssh_args.push("-o".into());
        ssh_args.push("PubkeyAuthentication=no".into());
        ssh_args.push("-o".into());
        ssh_args.push("NumberOfPasswordPrompts=1".into());

        if let Some(password) = ssh_host_store::read_sensitive_field(&host.id, "password")? {
            if !password.is_empty() {
                auto_password = Some(password);
            }
        }
    }

    ssh_args.push(format!("{}@{}", host.username, host.host));

    let on_output = make_pty_output_callback(app_handle, tab_id.clone());

    let instance_id = state
        .pty_manager
        .open_pty(
            tab_id,
            ".".into(),
            Some("ssh".into()),
            ssh_args,
            extra_env,
            auto_password,
            cols,
            rows,
            on_output,
        )
        .await?;

    // Schedule temp-file cleanup after the auth handshake completes (~10 s is generous)
    if !temp_paths.is_empty() {
        let paths = Arc::new(temp_paths);
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(10));
            for p in paths.iter() {
                let _ = std::fs::remove_file(p);
            }
        });
    }

    Ok(instance_id)
}
