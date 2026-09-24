//! kelpie — a mobile web UI for the agents running on an opencode server.
//!
//! kelpie is one more client of opencode v2's background service. It reads the
//! session list (across every project), streams turns live, answers permissions
//! and forms, and pushes to a phone over Tailscale. There is no terminal
//! multiplexer, no log parsing, and no keystroke injection: opencode's HTTP API
//! is the whole integration surface.

pub mod api;
pub mod opencode;
pub mod push;
mod web;

/// The version this binary reports. Stamped from the git tag at release time,
/// and from `Cargo.toml` otherwise.
pub const VERSION: &str = env!("KELPIE_VERSION");

pub use api::AppState;
pub use opencode::OpencodeClient;
