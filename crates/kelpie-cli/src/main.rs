//! `kelpie` — the command line.
//!
//! `serve` is the daemon; the rest are read-only inspection and one test push.

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use anyhow::{Result, anyhow};
use clap::{Parser, Subcommand};
use tracing_subscriber::EnvFilter;

use kelpie::push::{self, Notification, PushStore};
use kelpie::{AppState, OpencodeClient};

#[derive(Parser)]
#[command(
    name = "kelpie",
    version,
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
    }
}

async fn cmd_serve(port: u16, static_dir: Option<PathBuf>) -> Result<()> {
    init_tracing();
    let state = AppState::new();
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    kelpie::api::serve(state, addr, static_dir).await?;
    Ok(())
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
    println!("kelpie {}", env!("CARGO_PKG_VERSION"));

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
