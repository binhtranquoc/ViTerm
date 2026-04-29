use crate::core::ssh_host_store;
use crate::models::ssh_host::{CreateSshHostPayload, SshHost, SshHostSecrets, UpdateSshHostPayload};

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
