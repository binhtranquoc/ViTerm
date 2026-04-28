use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use chrono::Utc;
use uuid::Uuid;

use crate::models::ssh_host::{CreateSshHostPayload, SshHost, SshSourcesFile, UpdateSshHostPayload};

// ── config dir ─────────────────────────────────────────────────────────────────

fn config_dir() -> Result<PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| "Cannot resolve HOME".to_string())?;
    let dir = PathBuf::from(home).join(".logpane");
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(dir)
}

// ── sources file (host metadata) ──────────────────────────────────────────────

fn sources_file_path() -> Result<PathBuf, String> {
    Ok(config_dir()?.join("sources.json"))
}

fn read_sources_file() -> Result<SshSourcesFile, String> {
    let path = sources_file_path()?;
    if !path.exists() {
        return Ok(SshSourcesFile {
            ssh_hosts: vec![],
            groups: vec![],
        });
    }
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str::<SshSourcesFile>(&content).map_err(|e| e.to_string())
}

fn write_sources_file(file: &SshSourcesFile) -> Result<(), String> {
    let path = sources_file_path()?;
    let json = serde_json::to_string_pretty(file).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

// ── credentials file (sensitive secrets, 0600) ────────────────────────────────

fn credentials_file_path() -> Result<PathBuf, String> {
    Ok(config_dir()?.join(".credentials.json"))
}

fn read_credentials() -> Result<HashMap<String, String>, String> {
    let path = credentials_file_path()?;
    if !path.exists() {
        return Ok(HashMap::new());
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

fn write_credentials(creds: &HashMap<String, String>) -> Result<(), String> {
    let path = credentials_file_path()?;
    let json = serde_json::to_string(creds).map_err(|e| e.to_string())?;
    fs::write(&path, &json).map_err(|e| e.to_string())?;
    // Restrict to owner read/write only
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn save_sensitive_field(id: &str, field_name: &str, value: &str) -> Result<(), String> {
    let mut creds = read_credentials()?;
    creds.insert(format!("ssh-{id}-{field_name}"), value.to_string());
    write_credentials(&creds)
}

pub fn read_sensitive_field(id: &str, field_name: &str) -> Result<Option<String>, String> {
    let creds = read_credentials()?;
    Ok(creds.get(&format!("ssh-{id}-{field_name}")).cloned())
}

fn delete_sensitive_fields(id: &str) {
    if let Ok(mut creds) = read_credentials() {
        for field in ["password", "private-key", "passphrase"] {
            creds.remove(&format!("ssh-{id}-{field}"));
        }
        let _ = write_credentials(&creds);
    }
}

// ── public CRUD ────────────────────────────────────────────────────────────────

fn normalize_group_parent(value: Option<String>) -> Option<String> {
    value
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

fn rebuild_groups_from_hosts(file: &mut SshSourcesFile) {
    let mut groups: Vec<String> = file
        .ssh_hosts
        .iter()
        .filter_map(|h| h.group_parent.as_ref().map(|g| g.trim().to_string()))
        .filter(|g| !g.is_empty())
        .collect();
    groups.sort();
    groups.dedup();
    file.groups = groups;
}

pub fn list_ssh_groups() -> Result<Vec<String>, String> {
    let mut file = read_sources_file()?;
    rebuild_groups_from_hosts(&mut file);
    Ok(file.groups)
}

pub fn list_ssh_hosts() -> Result<Vec<SshHost>, String> {
    Ok(read_sources_file()?.ssh_hosts)
}

pub fn create_ssh_host(payload: CreateSshHostPayload) -> Result<SshHost, String> {
    if payload.auth_type != "password" && payload.auth_type != "private_key" {
        return Err("auth_type must be either `password` or `private_key`".to_string());
    }

    let mut file = read_sources_file()?;
    let now = Utc::now().to_rfc3339();
    let id = Uuid::new_v4().to_string();

    let host = SshHost {
        id: id.clone(),
        name: payload.name.trim().to_string(),
        host: payload.host.trim().to_string(),
        port: payload.port,
        username: payload.username.trim().to_string(),
        group_parent: normalize_group_parent(payload.group_parent),
        tags: payload.tags.into_iter().map(|t| t.trim().to_string()).filter(|t| !t.is_empty()).collect(),
        auth_type: payload.auth_type,
        log_path: payload.log_path.map(|v| v.trim().to_string()),
        created_at: now.clone(),
        updated_at: now,
    };

    if let Some(pw) = payload.password { if !pw.is_empty() { save_sensitive_field(&id, "password", &pw)?; } }
    if let Some(pk) = payload.private_key { if !pk.is_empty() { save_sensitive_field(&id, "private-key", &pk)?; } }
    if let Some(pp) = payload.passphrase { if !pp.is_empty() { save_sensitive_field(&id, "passphrase", &pp)?; } }

    file.ssh_hosts.push(host.clone());
    rebuild_groups_from_hosts(&mut file);
    write_sources_file(&file)?;
    Ok(host)
}

pub fn update_ssh_host(id: &str, payload: UpdateSshHostPayload) -> Result<SshHost, String> {
    if payload.auth_type != "password" && payload.auth_type != "private_key" {
        return Err("auth_type must be either `password` or `private_key`".to_string());
    }

    let mut file = read_sources_file()?;
    let host = file.ssh_hosts.iter_mut().find(|h| h.id == id)
        .ok_or_else(|| format!("SSH host not found: {id}"))?;

    host.name = payload.name.trim().to_string();
    host.host = payload.host.trim().to_string();
    host.port = payload.port;
    host.username = payload.username.trim().to_string();
    host.group_parent = normalize_group_parent(payload.group_parent);
    host.tags = payload.tags.into_iter().map(|t| t.trim().to_string()).filter(|t| !t.is_empty()).collect();
    host.auth_type = payload.auth_type;
    host.log_path = payload.log_path.map(|v| v.trim().to_string());
    host.updated_at = Utc::now().to_rfc3339();

    if let Some(pw) = payload.password { if !pw.is_empty() { save_sensitive_field(id, "password", &pw)?; } }
    if let Some(pk) = payload.private_key { if !pk.is_empty() { save_sensitive_field(id, "private-key", &pk)?; } }
    if let Some(pp) = payload.passphrase { if !pp.is_empty() { save_sensitive_field(id, "passphrase", &pp)?; } }

    let updated = host.clone();
    rebuild_groups_from_hosts(&mut file);
    write_sources_file(&file)?;
    Ok(updated)
}

pub fn delete_ssh_host(id: &str) -> Result<(), String> {
    let mut file = read_sources_file()?;
    file.ssh_hosts.retain(|h| h.id != id);
    rebuild_groups_from_hosts(&mut file);
    write_sources_file(&file)?;
    delete_sensitive_fields(id);
    Ok(())
}
