//! `kelpie service` — keep the bridge running.
//!
//! macOS uses a per-user LaunchAgent (`~/Library/LaunchAgents`), which starts
//! at login and restarts on failure. The plist is written here rather than
//! shipped, because the binary path and port are this machine's.

use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{Context, Result, bail};

/// The LaunchAgent label. Reverse-DNS so it is unambiguous.
const LABEL: &str = "dev.kelpie.serve";

pub fn install(port: u16, binary: Option<PathBuf>) -> Result<()> {
    let binary = binary.unwrap_or_else(stable_binary);
    let plist = plist_path()?;
    let log = log_path()?;

    if let Some(parent) = plist.parent() {
        std::fs::create_dir_all(parent)?;
    }
    if let Some(parent) = log.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&plist, plist_xml(&binary, port, &log))
        .with_context(|| format!("writing {}", plist.display()))?;

    let domain = domain()?;
    // Replace any previous registration (a no-op when there is none).
    let _ = Command::new("launchctl")
        .args(["bootout", &format!("{domain}/{LABEL}")])
        .output();
    let output = Command::new("launchctl")
        .args(["bootstrap", &domain, &plist.to_string_lossy()])
        .output()
        .context("running launchctl bootstrap")?;
    if !output.status.success() {
        bail!(
            "launchctl bootstrap failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }

    println!("installed {LABEL}");
    println!("  plist  : {}", plist.display());
    println!("  binary : {}", binary.display());
    println!("  log    : {}", log.display());
    println!("  url    : http://127.0.0.1:{port}");
    println!();
    println!(
        "expose it on the tailnet:  tailscale serve --bg --https=8443 http://127.0.0.1:{port}"
    );
    Ok(())
}

pub fn uninstall() -> Result<()> {
    let plist = plist_path()?;
    let domain = domain()?;
    let _ = Command::new("launchctl")
        .args(["bootout", &format!("{domain}/{LABEL}")])
        .output();
    if plist.exists() {
        std::fs::remove_file(&plist).with_context(|| format!("removing {}", plist.display()))?;
    }
    println!("removed {LABEL}");
    Ok(())
}

pub fn status() -> Result<()> {
    let plist = plist_path()?;
    println!("label  : {LABEL}");
    println!(
        "plist  : {} ({})",
        plist.display(),
        if plist.exists() { "present" } else { "missing" }
    );
    let domain = domain()?;
    let output = Command::new("launchctl")
        .args(["print", &format!("{domain}/{LABEL}")])
        .output()
        .context("running launchctl print")?;
    if output.status.success() {
        let text = String::from_utf8_lossy(&output.stdout);
        let state = text
            .lines()
            .find(|line| line.trim_start().starts_with("state ="))
            .map(str::trim)
            .unwrap_or("state = ?");
        println!("launchd: loaded ({state})");
    } else {
        println!("launchd: not loaded");
    }
    Ok(())
}

fn plist_path() -> Result<PathBuf> {
    let home = std::env::var_os("HOME").context("HOME is not set")?;
    Ok(PathBuf::from(home)
        .join("Library/LaunchAgents")
        .join(format!("{LABEL}.plist")))
}

fn log_path() -> Result<PathBuf> {
    kelpie::push::state_dir()
        .context("cannot determine the state dir")
        .map(|dir| dir.join("serve.log"))
}

fn domain() -> Result<String> {
    let output = Command::new("id")
        .arg("-u")
        .output()
        .context("running id -u")?;
    let uid = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if uid.is_empty() {
        bail!("cannot determine the uid");
    }
    Ok(format!("gui/{uid}"))
}

/// The binary to point the agent at.
///
/// A mise install lives at `…/installs/<tool>/<version>/<bin>` with a `latest`
/// symlink to the newest version, so a plist through `latest` follows `mise
/// upgrade` instead of pinning one version.
fn stable_binary() -> PathBuf {
    let exe = std::env::current_exe().unwrap_or_else(|_| PathBuf::from("kelpie"));
    let text = exe.to_string_lossy();
    if let Some(position) = text.find("/mise/installs/") {
        let rest = &text[position + "/mise/installs/".len()..];
        let mut parts = rest.splitn(3, '/');
        if let (Some(tool), Some(_version), Some(tail)) = (parts.next(), parts.next(), parts.next())
        {
            return PathBuf::from(format!(
                "{}/mise/installs/{tool}/latest/{tail}",
                &text[..position]
            ));
        }
    }
    exe
}

/// launchd starts with a minimal environment, so `PATH` must be spelled out or
/// kelpie cannot find `opencode` (which is usually a mise shim).
fn launch_path() -> String {
    let home = std::env::var("HOME").unwrap_or_default();
    [
        format!("{home}/.local/share/mise/shims"),
        format!("{home}/.local/bin"),
        "/opt/homebrew/bin".to_string(),
        "/usr/local/bin".to_string(),
        "/usr/bin".to_string(),
        "/bin".to_string(),
        "/usr/sbin".to_string(),
        "/sbin".to_string(),
    ]
    .join(":")
}

fn plist_xml(binary: &Path, port: u16, log: &Path) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>{LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>{binary}</string>
    <string>serve</string>
    <string>--port</string>
    <string>{port}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>{log}</string>
  <key>StandardErrorPath</key>
  <string>{log}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>{path}</string>
  </dict>
</dict>
</plist>
"#,
        binary = binary.display(),
        log = log.display(),
        path = launch_path(),
    )
}
