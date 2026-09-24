//! Finding the opencode v2 background service.
//!
//! v2 keeps one service running and lets clients attach to it, so kelpie does
//! not start or own anything: it asks the CLI where the service is, and reads
//! the Basic-auth password the service wrote next to its config.

use std::path::PathBuf;

/// The service URL. `opencode service status` prints `http://127.0.0.1:<port>`.
pub fn service_url() -> Option<String> {
    let output = std::process::Command::new("opencode")
        .args(["service", "status"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let url = text.trim();
    if url.starts_with("http") {
        Some(url.to_string())
    } else {
        None
    }
}

/// The Basic-auth password (`~/.config/opencode/service.json`, mode 0600). The
/// username is always `opencode`.
pub fn service_password() -> Option<String> {
    let home = std::env::var_os("HOME")?;
    let path = PathBuf::from(home).join(".config/opencode/service.json");
    let text = std::fs::read_to_string(path).ok()?;
    let value: serde_json::Value = serde_json::from_str(&text).ok()?;
    value
        .get("password")
        .and_then(|value| value.as_str())
        .map(str::to_string)
}
