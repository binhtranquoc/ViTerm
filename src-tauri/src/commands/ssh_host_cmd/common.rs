use std::os::unix::fs::PermissionsExt;
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use serde_json::json;
use tauri::Emitter;
use uuid::Uuid;

use crate::core::ssh_host_store;
use crate::models::ssh_host::SshHost;

pub(crate) const SSH_MAX_RETRIES: u32 = 5;
pub(crate) const SSH_FILE_LOG_READY_MARKER: &str = "__QBASE_SSH_FILE_LOG_READY__";

#[derive(Clone)]
pub(crate) struct SshLaunchContext {
    pub ssh_args: Vec<String>,
    pub auto_password: Option<String>,
    pub temp_paths: Vec<std::path::PathBuf>,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct SshSessionStatePayload {
    tab_id: String,
    host_id: String,
    state: String,
    attempt: u32,
    instance_id: Option<String>,
    reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SshRemoteEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct SshRemoteListResult {
    pub base_path: String,
    pub entries: Vec<SshRemoteEntry>,
}

/// Writes a private key to a temp file with restricted permissions (0600).
fn write_temp_key(key_content: &str) -> Result<std::path::PathBuf, String> {
    let id = Uuid::new_v4().to_string();
    let path = std::env::temp_dir().join(format!("qbase_key_{id}"));
    std::fs::write(&path, key_content).map_err(|error| error.to_string())?;
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))
        .map_err(|error| error.to_string())?;
    Ok(path)
}

pub(crate) fn emit_ssh_state(
    app_handle: &tauri::AppHandle,
    tab_id: &str,
    host_id: &str,
    state: &str,
    attempt: u32,
    instance_id: Option<String>,
    reason: Option<String>,
) {
    let payload = SshSessionStatePayload {
        tab_id: tab_id.to_string(),
        host_id: host_id.to_string(),
        state: state.to_string(),
        attempt,
        instance_id,
        reason,
    };
    if let Err(error) = app_handle.emit("ssh-session-state", payload) {
        eprintln!("emit ssh-session-state failed: {error}");
    }
}

pub(crate) fn schedule_temp_key_cleanup(paths: Vec<std::path::PathBuf>) {
    if paths.is_empty() {
        return;
    }
    let paths = Arc::new(paths);
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(10));
        for path in paths.iter() {
            let _ = std::fs::remove_file(path);
        }
    });
}

pub(crate) fn build_ssh_launch_context(host: &SshHost) -> Result<SshLaunchContext, String> {
    let mut ssh_args: Vec<String> = vec![
        "-o".into(),
        "StrictHostKeyChecking=accept-new".into(),
        "-o".into(),
        "ConnectTimeout=12".into(),
        "-o".into(),
        "ServerAliveInterval=20".into(),
        "-o".into(),
        "ServerAliveCountMax=3".into(),
        "-o".into(),
        "TCPKeepAlive=yes".into(),
        "-p".into(),
        host.port.to_string(),
    ];

    let mut temp_paths: Vec<std::path::PathBuf> = vec![];
    let mut auto_password: Option<String> = None;
    let mut has_passphrase_secret = false;
    let mut has_account_password_secret = false;

    if host.auth_type == "private_key" {
        if let Some(key_content) = ssh_host_store::read_sensitive_field(&host.id, "private-key")? {
            let key_path = write_temp_key(&key_content)?;
            ssh_args.push("-i".into());
            ssh_args.push(key_path.to_string_lossy().into_owned());
            temp_paths.push(key_path);
        }

        let mut passphrase_secret: Option<String> = None;
        if let Some(passphrase) = ssh_host_store::read_sensitive_field(&host.id, "passphrase")? {
            let cleaned = passphrase.trim().to_string();
            if !cleaned.is_empty() {
                passphrase_secret = Some(cleaned);
                has_passphrase_secret = true;
            }
        }

        let mut account_password_secret: Option<String> = None;
        if let Some(password) = ssh_host_store::read_sensitive_field(&host.id, "password")? {
            let cleaned = password.trim().to_string();
            if !cleaned.is_empty() {
                account_password_secret = Some(cleaned);
                has_account_password_secret = true;
            }
        }

        auto_password = match (passphrase_secret, account_password_secret) {
            (Some(passphrase), Some(password)) => {
                let encoded = json!({ "password": password, "passphrase": passphrase });
                Some(format!("__SSH_AUTO_SECRETS__{}", encoded))
            }
            (Some(passphrase), None) => Some(passphrase),
            (None, Some(password)) => Some(password),
            (None, None) => None,
        };
    } else {
        ssh_args.push("-o".into());
        ssh_args.push("PreferredAuthentications=password".into());
        ssh_args.push("-o".into());
        ssh_args.push("PubkeyAuthentication=no".into());
        ssh_args.push("-o".into());
        ssh_args.push("KbdInteractiveAuthentication=no".into());
        ssh_args.push("-o".into());
        ssh_args.push("NumberOfPasswordPrompts=10".into());

        ssh_args.push("-o".into());
        ssh_args.push("PasswordAuthentication=yes".into());

        if let Some(password) = ssh_host_store::read_sensitive_field(&host.id, "password")? {
            let cleaned = password.trim().to_string();
            if !cleaned.is_empty() {
                auto_password = Some(cleaned);
                has_account_password_secret = true;
            }
        }
    }

    eprintln!(
        "[ssh-launch-context] auth_type={} user@{} has_passphrase_secret={} has_account_password_secret={} auto_password_set={}",
        host.auth_type,
        format!("{}@{}:{}", host.username, host.host, host.port),
        has_passphrase_secret,
        has_account_password_secret,
        auto_password.as_ref().map(|value| !value.is_empty()).unwrap_or(false)
    );

    ssh_args.push(format!("{}@{}", host.username, host.host));

    Ok(SshLaunchContext {
        ssh_args,
        auto_password,
        temp_paths,
    })
}

fn shell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', r"'\''"))
}

pub(crate) fn build_remote_list_script(base_path: &str) -> String {
    let quoted_path = shell_single_quote(base_path);
    format!(
            "P={quoted_path}; \
    if [ -d \"$P\" ]; then \
    for e in \"$P\"/* \"$P\"/.[!.]* \"$P\"/..?*; do \
    [ -e \"$e\" ] || continue; \
    n=$(basename \"$e\"); \
    if [ -d \"$e\" ]; then t=dir; else t=file; fi; \
    printf \"%s\\t%s\\t%s\\n\" \"$t\" \"$n\" \"$e\"; \
    done; \
    elif [ -f \"$P\" ]; then \
    n=$(basename \"$P\"); \
    printf \"file\\t%s\\t%s\\n\" \"$n\" \"$P\"; \
    fi")
}

pub(crate) fn parse_remote_list_output(raw_output: &str) -> Vec<SshRemoteEntry> {
    raw_output
        .lines()
        .filter_map(|line| {
            let mut parts = line.splitn(3, '\t');
            let kind = parts.next()?;
            let name = parts.next()?.trim();
            let path = parts.next()?.trim();
            if name.is_empty() || path.is_empty() {
                return None;
            }
            Some(SshRemoteEntry {
                name: name.to_string(),
                path: path.to_string(),
                is_dir: kind == "dir",
            })
        })
        .collect::<Vec<_>>()
}
