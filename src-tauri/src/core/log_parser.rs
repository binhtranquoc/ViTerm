use regex::Regex;
use serde_json::json;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::LazyLock;
use uuid::Uuid;

use crate::features::log_viewer::models::log_entry::{LogEntry, LogLevel, LogParserType};
use crate::shared::utils::timestamp::now_iso_string;

pub fn parse_line(line: &str, source_id: &str) -> LogEntry {
    let stripped = strip_ansi(line);
    let normalized = strip_control_chars(&stripped);
    let cleaned = normalized.trim();
    if cleaned.is_empty() {
        return parse_plain_log("", source_id);
    }

    parse_json_log(cleaned, source_id)
        .or_else(|| parse_logfmt_log(cleaned, source_id))
        .or_else(|| parse_nginx_log(cleaned, source_id))
        .or_else(|| parse_laravel_log(cleaned, source_id))
        .or_else(|| parse_sqlserver_log(cleaned, source_id))
        .unwrap_or_else(|| parse_plain_log(cleaned, source_id))
}

pub fn is_laravel_log_start(line: &str) -> bool {
    static LARAVEL_START_RE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\]\s+[A-Za-z0-9_.-]+\.[A-Z]+:")
            .expect("invalid laravel-start regex")
    });
    LARAVEL_START_RE.is_match(line)
}

fn parse_laravel_log(line: &str, source_id: &str) -> Option<LogEntry> {
    static LARAVEL_RE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(
            r"(?s)^\[(?P<timestamp>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]\s+(?P<channel>[A-Za-z0-9_.-]+)\.(?P<level>[A-Z]+):\s*(?P<message>.*)$",
        )
        .expect("invalid laravel regex")
    });
    static EXCEPTION_RE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"([A-Za-z_\\][A-Za-z0-9_\\]+(?:Exception|Error))").expect("invalid exception regex")
    });

    let captures = LARAVEL_RE.captures(line)?;
    let timestamp_raw = captures.name("timestamp")?.as_str().to_string();
    let channel = captures.name("channel")?.as_str().to_string();
    let level_raw = captures.name("level")?.as_str().to_lowercase();
    let message = captures.name("message")?.as_str().trim().to_string();
    let timestamp = normalize_timestamp(format!("{timestamp_raw}Z"));
    let level = match level_raw.as_str() {
        "error" | "critical" | "alert" | "emergency" => LogLevel::Error,
        "warning" | "warn" => LogLevel::Warn,
        "notice" | "info" => LogLevel::Info,
        "debug" => LogLevel::Debug,
        _ => LogLevel::Unknown,
    };

    let mut fields = extract_text_fields(&message);
    fields.insert("profile".to_string(), "laravel".to_string());
    fields.insert("channel".to_string(), channel.clone());
    fields.insert("level".to_string(), level_raw);
    if let Some(exception) = EXCEPTION_RE
        .captures(&message)
        .and_then(|caps| caps.get(1))
        .map(|value| value.as_str().to_string())
    {
        fields.insert("exception".to_string(), exception);
    }

    Some(LogEntry {
        id: Uuid::new_v4().to_string(),
        source_id: source_id.to_string(),
        timestamp,
        level,
        parser_type: LogParserType::Laravel,
        message: message.clone(),
        raw: line.to_string(),
        fields,
    })
}

fn parse_json_log(line: &str, source_id: &str) -> Option<LogEntry> {
    let value: Value = extract_json_object(line)?;
    let level = detect_level_from_json(&value);
    let message = detect_message_from_json(&value).unwrap_or_else(|| line.to_string());
    let timestamp = detect_timestamp_from_json(&value)
        .map(normalize_timestamp)
        .unwrap_or_else(|| extract_timestamp_from_text(line));

    Some(LogEntry {
        id: Uuid::new_v4().to_string(),
        source_id: source_id.to_string(),
        timestamp,
        level,
        parser_type: LogParserType::Json,
        message,
        raw: line.to_string(),
        fields: extract_json_fields(&value),
    })
}

fn parse_plain_log(line: &str, source_id: &str) -> LogEntry {
    LogEntry {
        id: Uuid::new_v4().to_string(),
        source_id: source_id.to_string(),
        timestamp: extract_timestamp_from_text(line),
        level: detect_level_from_text(line),
        parser_type: LogParserType::Text,
        message: line.to_string(),
        raw: line.to_string(),
        fields: extract_text_fields(line),
    }
}

fn parse_logfmt_log(line: &str, source_id: &str) -> Option<LogEntry> {
    let fields = extract_text_fields(line);
    if fields.len() < 2 {
        return None;
    }

    let level = fields
        .get("level")
        .or_else(|| fields.get("lvl"))
        .map(|value| detect_level_from_text(value))
        .filter(|detected| !matches!(detected, LogLevel::Unknown))
        .unwrap_or_else(|| detect_level_from_text(line));
    let timestamp = fields
        .get("time")
        .or_else(|| fields.get("timestamp"))
        .cloned()
        .map(normalize_timestamp)
        .unwrap_or_else(|| extract_timestamp_from_text(line));
    let message = fields
        .get("msg")
        .or_else(|| fields.get("message"))
        .or_else(|| fields.get("event"))
        .cloned()
        .unwrap_or_else(|| line.to_string());

    let mut enriched_fields = fields;
    enriched_fields.insert("profile".to_string(), "logfmt".to_string());

    Some(LogEntry {
        id: Uuid::new_v4().to_string(),
        source_id: source_id.to_string(),
        timestamp,
        level,
        parser_type: LogParserType::Logfmt,
        message,
        raw: line.to_string(),
        fields: enriched_fields,
    })
}

fn parse_nginx_log(line: &str, source_id: &str) -> Option<LogEntry> {
    static NGINX_COMBINED_RE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r#"^(?:[\w][\w.-]*\s*\|\s*)?(\S+)\s+-\s+(\S+)\s+\[([^\]]+)\]\s+"([A-Z]+)\s+([^\s"]+)[^"]*"\s+(\d{3})\s+(\d+|-)\s+"([^"]*)"\s+"([^"]*)"(?:\s+"([^"]*)")?"#)
            .expect("invalid nginx regex")
    });

    let captures = NGINX_COMBINED_RE.captures(line)?;

    let ip = captures.get(1)?.as_str();
    let time_str = captures.get(3)?.as_str();
    let method = captures.get(4)?.as_str();
    let path = captures.get(5)?.as_str();
    let status_text = captures.get(6)?.as_str();
    let bytes_text = captures.get(7)?.as_str();
    let referer = captures.get(8)?.as_str();
    let ua = captures.get(9)?.as_str();
    let real_ip = captures
        .get(10)
        .map(|item| item.as_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("-");

    let status_num = status_text.parse::<u16>().ok()?;
    let bytes_num = if bytes_text == "-" {
        0
    } else {
        bytes_text.parse::<u64>().ok().unwrap_or(0)
    };
    let level = if status_num >= 500 {
        LogLevel::Error
    } else if status_num >= 400 {
        LogLevel::Warn
    } else {
        LogLevel::Info
    };

    let timestamp = parse_nginx_date(time_str).unwrap_or_else(now_iso_string);
    let message = format!("{method} {path} -> {status_num} ({bytes_num}b)");
    let normalized_real_ip = if real_ip == "-" || real_ip.is_empty() {
        ip
    } else {
        real_ip
    };
    let structured = json!({
        "ip": normalized_real_ip,
        "method": method,
        "path": path,
        "status": status_num,
        "bytes": bytes_num,
        "ua": ua,
        "referer": referer,
        "timestamp": timestamp,
        "source": "nginx-access",
    });
    let raw = serde_json::to_string(&structured).unwrap_or_else(|_| line.to_string());

    Some(LogEntry {
        id: Uuid::new_v4().to_string(),
        source_id: source_id.to_string(),
        timestamp,
        level,
        parser_type: LogParserType::Nginx,
        message,
        raw,
        fields: extract_json_fields(&structured),
    })
}

fn parse_sqlserver_log(line: &str, source_id: &str) -> Option<LogEntry> {
    static SQLSERVER_LINE_RE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(
            r#"^(?P<timestamp>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:[.,]\d+)?)\s+(?P<category>[A-Za-z][\w.-]*)\s+(?P<message>.+)$"#,
        )
        .expect("invalid sqlserver line regex")
    });
    static SQLSERVER_ERROR_DETAIL_RE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(
            r#"(?i)Error:\s*(?P<error_code>\d+),\s*Severity:\s*(?P<severity>\d+),\s*State:\s*(?P<state>\d+)\.?"#,
        )
        .expect("invalid sqlserver detail regex")
    });
    static SQLSERVER_LOGIN_FAILED_RE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(
            r#"(?i)^Login failed for user '(?P<username>[^']+)'\.\s*Reason:\s*(?P<reason>.+?)\s*\[CLIENT:\s*(?P<client>[^\]]+)\]"#,
        )
        .expect("invalid sqlserver login regex")
    });

    let captures = SQLSERVER_LINE_RE.captures(line)?;
    let timestamp_raw = captures.name("timestamp")?.as_str().to_string();
    let category = captures.name("category")?.as_str().to_string();
    let message = captures.name("message")?.as_str().trim().to_string();

    let mut fields = HashMap::new();
    fields.insert("profile".to_string(), "sqlserver".to_string());
    fields.insert("category".to_string(), category.clone());

    let lower_message = message.to_lowercase();
    let mut level = if lower_message.contains("error") || lower_message.contains("failed") {
        LogLevel::Error
    } else if lower_message.contains("warning") || lower_message.contains("warn") {
        LogLevel::Warn
    } else {
        detect_level_from_text(&message)
    };

    if let Some(error_detail) = SQLSERVER_ERROR_DETAIL_RE.captures(&message) {
        if let Some(error_code) = error_detail.name("error_code") {
            fields.insert("error_code".to_string(), error_code.as_str().to_string());
        }
        if let Some(severity_text) = error_detail.name("severity") {
            fields.insert("severity".to_string(), severity_text.as_str().to_string());
            if let Ok(severity_value) = severity_text.as_str().parse::<u16>() {
                if severity_value >= 11 {
                    level = LogLevel::Error;
                } else if severity_value >= 6 {
                    level = LogLevel::Warn;
                }
            }
        }
        if let Some(state_text) = error_detail.name("state") {
            fields.insert("state".to_string(), state_text.as_str().to_string());
        }
    }

    if let Some(login_failed) = SQLSERVER_LOGIN_FAILED_RE.captures(&message) {
        if let Some(username) = login_failed.name("username") {
            fields.insert("username".to_string(), username.as_str().to_string());
        }
        if let Some(reason) = login_failed.name("reason") {
            fields.insert("reason".to_string(), reason.as_str().trim().to_string());
        }
        if let Some(client) = login_failed.name("client") {
            fields.insert("client".to_string(), client.as_str().trim().to_string());
        }
        level = LogLevel::Error;
    }

    Some(LogEntry {
        id: Uuid::new_v4().to_string(),
        source_id: source_id.to_string(),
        timestamp: normalize_timestamp(timestamp_raw),
        level,
        parser_type: LogParserType::Text,
        message: message.clone(),
        raw: line.to_string(),
        fields,
    })
}

fn extract_json_fields(value: &Value) -> HashMap<String, String> {
    let mut fields = HashMap::new();
    flatten_json_fields("", value, &mut fields);
    fields
}

fn flatten_json_fields(prefix: &str, value: &Value, fields: &mut HashMap<String, String>) {
    match value {
        Value::Object(map) => {
            for (key, child) in map {
                let next_prefix = if prefix.is_empty() {
                    key.to_string()
                } else {
                    format!("{prefix}.{key}")
                };
                flatten_json_fields(&next_prefix, child, fields);
            }
        }
        Value::Array(items) => {
            if items.is_empty() || prefix.is_empty() {
                return;
            }
            fields.insert(prefix.to_string(), serde_json::to_string(items).unwrap_or_default());
        }
        Value::String(text) => {
            if !prefix.is_empty() {
                fields.insert(prefix.to_string(), text.to_string());
            }
        }
        Value::Number(number) => {
            if !prefix.is_empty() {
                fields.insert(prefix.to_string(), number.to_string());
            }
        }
        Value::Bool(flag) => {
            if !prefix.is_empty() {
                fields.insert(prefix.to_string(), flag.to_string());
            }
        }
        Value::Null => {}
    }
}

fn extract_text_fields(text: &str) -> HashMap<String, String> {
    static KV_RE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r#"(?P<key>[A-Za-z_][A-Za-z0-9_.-]*)=(?:"(?P<dq>[^"]*)"|'(?P<sq>[^']*)'|(?P<bare>[^\s]+))"#)
            .expect("invalid key-value regex")
    });

    let mut fields = HashMap::new();
    for captures in KV_RE.captures_iter(text) {
        let Some(key_match) = captures.name("key") else {
            continue;
        };
        let value = captures
            .name("dq")
            .or_else(|| captures.name("sq"))
            .or_else(|| captures.name("bare"))
            .map(|entry| entry.as_str())
            .unwrap_or("");
        if !value.is_empty() {
            fields.insert(key_match.as_str().to_string(), value.to_string());
        }
    }
    fields
}

fn detect_level_from_json(value: &Value) -> LogLevel {
    let raw_level = [
        value.get("level"),
        value.get("severity"),
        value.get("lvl"),
        value.pointer("/log/level"),
    ]
    .iter()
    .flatten()
    .find_map(|value| value.as_str())
    .unwrap_or("unknown")
    .to_lowercase();

    match raw_level.as_str() {
        "error" | "err" | "fatal" | "fata" | "critical" => LogLevel::Error,
        "warn" | "warning" => LogLevel::Warn,
        "info" | "notice" => LogLevel::Info,
        "debug" | "trace" | "verbose" => LogLevel::Debug,
        _ => LogLevel::Unknown,
    }
}

fn detect_message_from_json(value: &Value) -> Option<String> {
    [
        value.get("message"),
        value.get("msg"),
        value.get("event"),
        value.pointer("/log/message"),
    ]
    .iter()
    .flatten()
    .find_map(|value| value.as_str())
    .map(ToString::to_string)
}

fn detect_timestamp_from_json(value: &Value) -> Option<String> {
    [
        value.get("timestamp"),
        value.get("time"),
        value.get("@timestamp"),
        value.pointer("/log/time"),
    ]
    .iter()
    .flatten()
    .find_map(|value| value.as_str())
    .map(ToString::to_string)
}

fn strip_ansi(raw: &str) -> String {
    static ANSI_ESCAPE_RE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|][^\x07]*(?:\x07|\x1b\\))")
            .expect("invalid ansi regex")
    });
    ANSI_ESCAPE_RE.replace_all(raw, "").to_string()
}

fn strip_control_chars(raw: &str) -> String {
    static CONTROL_CHAR_RE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]").expect("invalid control-char regex")
    });
    CONTROL_CHAR_RE.replace_all(raw, "").to_string()
}

fn extract_json_object(line: &str) -> Option<Value> {
    let start = line.find('{')?;
    let slice = &line[start..];
    if let Ok(value) = serde_json::from_str::<Value>(slice) {
        if value.is_object() {
            return Some(value);
        }
    }

    let end = slice.rfind('}')?;
    if end == 0 {
        return None;
    }

    let candidate = &slice[..=end];
    let value = serde_json::from_str::<Value>(candidate).ok()?;
    if value.is_object() {
        Some(value)
    } else {
        None
    }
}

fn detect_level_from_text(text: &str) -> LogLevel {
    static ERROR_RE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"(?i)\b(?:error|err|fatal|fata|crit(?:ical)?|fail(?:ed)?|panic)\b")
            .expect("invalid error regex")
    });
    static WARN_RE: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"(?i)\b(?:warn(?:ing)?|wrn)\b").expect("invalid warn regex"));
    static DEBUG_RE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"(?i)\b(?:debug|dbg|trace|trce|verbose|verb)\b").expect("invalid debug regex")
    });
    static INFO_RE: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"(?i)\b(?:info|inf|notice)\b").expect("invalid info regex"));

    if ERROR_RE.is_match(text) {
        return LogLevel::Error;
    }
    if WARN_RE.is_match(text) {
        return LogLevel::Warn;
    }
    if DEBUG_RE.is_match(text) {
        return LogLevel::Debug;
    }
    if INFO_RE.is_match(text) {
        return LogLevel::Info;
    }
    LogLevel::Unknown
}

fn extract_timestamp_from_text(text: &str) -> String {
    static ISO_RE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))")
            .expect("invalid iso timestamp regex")
    });
    static COMMON_RE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:[,. ]\d+)?)")
            .expect("invalid common timestamp regex")
    });
    static TIME_ONLY_RE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"(?:^|\s)(\d{2}:\d{2}:\d{2}(?:\.\d+)?)").expect("invalid time-only regex")
    });
    static UNIX_RE: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"\b(\d{10}(?:\.\d+)?|\d{13})\b").expect("invalid unix regex"));

    for re in [&*ISO_RE, &*COMMON_RE, &*TIME_ONLY_RE, &*UNIX_RE] {
        if let Some(captures) = re.captures(text) {
            if let Some(raw) = captures.get(1) {
                let value = raw.as_str();
                if let Some(parsed) = parse_unix_timestamp(value) {
                    return parsed;
                }
                let normalized = normalize_timestamp(value.to_string());
                if normalized != value {
                    return normalized;
                }
            }
        }
    }
    now_iso_string()
}

fn parse_unix_timestamp(raw: &str) -> Option<String> {
    let pure_digits = raw.chars().all(|ch| ch.is_ascii_digit());
    if !pure_digits {
        return None;
    }
    match raw.len() {
        10 => {
            let seconds = raw.parse::<i64>().ok()?;
            Some(
                chrono::DateTime::from_timestamp(seconds, 0)
                    .map(|datetime| datetime.to_rfc3339())
                    .unwrap_or_else(now_iso_string),
            )
        }
        13 => {
            let millis = raw.parse::<i64>().ok()?;
            let seconds = millis / 1000;
            let nanos = ((millis % 1000) * 1_000_000) as u32;
            Some(
                chrono::DateTime::from_timestamp(seconds, nanos)
                    .map(|datetime| datetime.to_rfc3339())
                    .unwrap_or_else(now_iso_string),
            )
        }
        _ => None,
    }
}

fn normalize_timestamp(raw: String) -> String {
    let sanitized = raw.replace(',', ".");
    chrono::DateTime::parse_from_rfc3339(&sanitized)
        .map(|datetime| datetime.to_rfc3339())
        .or_else(|_| {
            chrono::NaiveDateTime::parse_from_str(&sanitized, "%Y-%m-%d %H:%M:%S%.f")
                .map(|naive| {
                    chrono::DateTime::<chrono::Utc>::from_naive_utc_and_offset(naive, chrono::Utc)
                        .to_rfc3339()
                })
        })
        .unwrap_or(raw)
}

fn parse_nginx_date(raw: &str) -> Option<String> {
    chrono::DateTime::parse_from_str(raw, "%d/%b/%Y:%H:%M:%S %z")
        .map(|datetime| datetime.to_rfc3339())
        .ok()
}
