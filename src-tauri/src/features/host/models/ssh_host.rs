use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshHost {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub group_parent: Option<String>,
    pub tags: Vec<String>,
    pub auth_type: String,
    pub log_path: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshSourcesFile {
    #[serde(default)]
    pub ssh_hosts: Vec<SshHost>,
    #[serde(default)]
    pub groups: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateSshHostPayload {
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub group_parent: Option<String>,
    pub tags: Vec<String>,
    pub auth_type: String,
    pub log_path: Option<String>,
    pub password: Option<String>,
    pub private_key: Option<String>,
    pub passphrase: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateSshHostPayload {
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub group_parent: Option<String>,
    pub tags: Vec<String>,
    pub auth_type: String,
    pub log_path: Option<String>,
    pub password: Option<String>,
    pub private_key: Option<String>,
    pub passphrase: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshHostSecrets {
    pub password: Option<String>,
    pub private_key: Option<String>,
    pub passphrase: Option<String>,
}
