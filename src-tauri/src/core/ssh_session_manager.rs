use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::{Mutex, watch};

#[derive(Clone, Default)]
pub struct SshSessionManager {
    sessions: Arc<Mutex<HashMap<String, watch::Sender<bool>>>>,
}

impl SshSessionManager {
    pub async fn start_session(&self, tab_id: String) -> watch::Receiver<bool> {
        self.cancel_session(&tab_id).await;
        let (tx, rx) = watch::channel(false);
        self.sessions.lock().await.insert(tab_id, tx);
        rx
    }

    pub async fn cancel_session(&self, tab_id: &str) {
        if let Some(sender) = self.sessions.lock().await.remove(tab_id) {
            let _ = sender.send(true);
        }
    }

    pub async fn is_session_active(&self, tab_id: &str) -> bool {
        self.sessions.lock().await.contains_key(tab_id)
    }
}
