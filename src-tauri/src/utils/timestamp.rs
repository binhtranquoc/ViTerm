use chrono::Utc;

pub fn now_iso_string() -> String {
    Utc::now().to_rfc3339()
}
