//! `kelpie` — the command line.
//!
//! `serve` is the daemon; the rest are read-only inspection and one test push.

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{Result, anyhow};
use clap::{Parser, Subcommand};
use tracing_subscriber::EnvFilter;

use kelpie::push::{self, Notification, PushStore};
use kelpie::{AppState, OpencodeClient};

mod service;

#[derive(Parser)]
#[command(
    name = "kelpie",
    version = kelpie::VERSION,
    about = "Mobile web UI for the agents running on an opencode server"
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Serve the API (and the built PWA, when present) on loopback.
    Serve {
        /// Loopback port to bind.
        #[arg(long, default_value_t = 7180)]
        port: u16,
        /// Directory of a PWA build to serve instead of the embedded one
        /// (development).
        #[arg(long)]
        static_dir: Option<PathBuf>,
    },
    /// List every opencode session across every project.
    Sessions {
        #[arg(long, default_value_t = 50)]
        limit: u32,
    },
    /// Print one session's messages.
    Messages {
        session: String,
        #[arg(long, default_value_t = 200)]
        limit: u32,
        #[arg(long)]
        json: bool,
    },
    /// Send one test push to every subscribed device.
    PushTest,
    /// Check the environment: the opencode service and the push store.
    Doctor,
    /// Keep the bridge running as a per-user service.
    Service {
        #[command(subcommand)]
        command: ServiceCommand,
    },
}

#[derive(Subcommand)]
enum ServiceCommand {
    /// Install and start a per-user LaunchAgent (macOS).
    Install {
        #[arg(long, default_value_t = 7180)]
        port: u16,
        /// Binary to run (defaults to this executable, through mise's `latest`).
        #[arg(long)]
        binary: Option<PathBuf>,
    },
    /// Stop and remove the agent.
    Uninstall,
    /// Restart the agent (after installing a new binary).
    Restart,
    /// Show whether the agent is installed and loaded.
    Status,
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Command::Serve { port, static_dir } => cmd_serve(port, static_dir).await,
        Command::Sessions { limit } => cmd_sessions(limit).await,
        Command::Messages {
            session,
            limit,
            json,
        } => cmd_messages(session, limit, json).await,
        Command::PushTest => cmd_push_test().await,
        Command::Doctor => cmd_doctor().await,
        Command::Service { command } => match command {
            ServiceCommand::Install { port, binary } => service::install(port, binary),
            ServiceCommand::Uninstall => service::uninstall(),
            ServiceCommand::Restart => service::restart(),
            ServiceCommand::Status => service::status(),
        },
    }
}

async fn cmd_serve(port: u16, static_dir: Option<PathBuf>) -> Result<()> {
    init_tracing();
    watch_binary_for_restart();
    let state = AppState::new();
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    kelpie::api::serve(state, addr, static_dir).await?;
    Ok(())
}

/// When the service is installed, a `mise install` swaps the binary on disk
/// while this process keeps running the old one. Watch the path the service
/// was installed for, and exit when it changes: launchd's KeepAlive starts the
/// new binary. Only runs when the plist set `KELPIE_AUTO_RESTART`, so a manual
/// `kelpie serve` is never killed out from under the operator.
fn watch_binary_for_restart() {
    if std::env::var("KELPIE_AUTO_RESTART").as_deref() != Ok("1") {
        return;
    }
    let Some(path) = std::env::var_os("KELPIE_BINARY_PATH").map(PathBuf::from) else {
        return;
    };
    let installed = fingerprint(&path);
    if installed.is_none() {
        return;
    }
    tokio::spawn(async move {
        let secs = std::env::var("KELPIE_RESTART_CHECK_SECS")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(300u64)
            .max(1);
        let mut ticker = tokio::time::interval(Duration::from_secs(secs));
        ticker.tick().await;
        loop {
            ticker.tick().await;
            if fingerprint(&path) != installed {
                tracing::info!("binary changed; exiting so the service restarts");
                std::process::exit(0);
            }
        }
    });
}

/// Size + mtime, or `None` when the path cannot be read.
fn fingerprint(path: &std::path::Path) -> Option<(u64, Option<std::time::SystemTime>)> {
    std::fs::metadata(path)
        .ok()
        .map(|meta| (meta.len(), meta.modified().ok()))
}

async fn cmd_sessions(limit: u32) -> Result<()> {
    let client = OpencodeClient::discover().map_err(|error| anyhow!("{error}"))?;
    let value = client.sessions(limit).await?;
    let sessions = value
        .get("data")
        .and_then(|data| data.as_array())
        .cloned()
        .unwrap_or_default();
    println!("service  : {}", client.base_url());
    println!("sessions : {}", sessions.len());
    for session in sessions {
        let id = session.get("id").and_then(|v| v.as_str()).unwrap_or("");
        let title = session.get("title").and_then(|v| v.as_str()).unwrap_or("");
        let directory = session
            .get("location")
            .and_then(|location| location.get("directory"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        println!("  {id}  {title}  [{directory}]");
    }
    Ok(())
}

async fn cmd_messages(session: String, limit: u32, json: bool) -> Result<()> {
    let client = OpencodeClient::discover().map_err(|error| anyhow!("{error}"))?;
    let value = client.messages(&session, limit.min(200)).await?;
    if json {
        println!("{}", serde_json::to_string_pretty(&value)?);
        return Ok(());
    }
    let messages = value
        .get("data")
        .and_then(|data| data.as_array())
        .cloned()
        .unwrap_or_default();
    println!("messages : {}", messages.len());
    for message in messages {
        let kind = message.get("type").and_then(|v| v.as_str()).unwrap_or("");
        let preview = match kind {
            "user" => message
                .get("text")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            "assistant" => message
                .get("content")
                .and_then(|content| content.as_array())
                .map(|parts| {
                    parts
                        .iter()
                        .map(|part| match part.get("type").and_then(|v| v.as_str()) {
                            Some("text") => part
                                .get("text")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string(),
                            Some("reasoning") => "[thinking]".to_string(),
                            Some("tool") => format!(
                                "[tool {}]",
                                part.get("name").and_then(|v| v.as_str()).unwrap_or("")
                            ),
                            Some(other) => format!("[{other}]"),
                            None => String::new(),
                        })
                        .collect::<Vec<_>>()
                        .join(" ")
                })
                .unwrap_or_default(),
            other => format!("[{other}]"),
        };
        let preview: String = preview.chars().take(120).collect();
        println!("  {kind:<16} {preview}");
    }
    Ok(())
}

async fn cmd_push_test() -> Result<()> {
    let store = Arc::new(PushStore::load());
    let count = store.subscriptions().len();
    if count == 0 {
        println!("no subscribed devices (enable notifications in the PWA first)");
        return Ok(());
    }
    let notification = Notification {
        title: "kelpie".to_string(),
        body: "テスト通知です。".to_string(),
        session_id: None,
        tag: "kelpie-test".to_string(),
    };
    push::broadcast(&store, &notification).await;
    println!("sent to {count} device(s)");
    Ok(())
}

async fn cmd_doctor() -> Result<()> {
    println!("kelpie {}", kelpie::VERSION);

    match OpencodeClient::discover() {
        Ok(client) => {
            println!("opencode : {}", client.base_url());
            match client.sessions(1).await {
                Ok(value) => {
                    let count = value
                        .get("data")
                        .and_then(|data| data.as_array())
                        .map(|items| items.len())
                        .unwrap_or(0);
                    println!("service  : ok (listed {count} session(s))");
                }
                Err(error) => println!("service  : FAIL {error}"),
            }
        }
        Err(error) => println!("opencode : FAIL {error}"),
    }

    let store = PushStore::load();
    println!(
        "push     : {} device(s), public key {}",
        store.subscriptions().len(),
        if store.public_key().is_some() {
            "ok"
        } else {
            "MISSING"
        }
    );
    if let Some(dir) = push::state_dir() {
        println!("state    : {}", dir.display());
    }
    Ok(())
}

fn init_tracing() {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    tracing_subscriber::fmt().with_env_filter(filter).init();
}
