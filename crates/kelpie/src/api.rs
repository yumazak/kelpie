//! The loopback HTTP API the PWA talks to.
//!
//! kelpie binds `127.0.0.1` only and lets one front door (`tailscale serve`)
//! proxy it. Everything here is a thin, authenticated pass-through to the
//! opencode service, plus the event relay and Web Push.

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::json;
use tokio::sync::{Mutex, broadcast};
use tokio_stream::{StreamExt, wrappers::BroadcastStream};

use crate::opencode::OpencodeClient;
use crate::push::{self, Notification, PushStore, Subscription};

/// How long a discovered opencode client is trusted before re-discovering. The
/// service picks a fresh port when it restarts.
const DISCOVERY_TTL: Duration = Duration::from_secs(30);

struct Inner {
    opencode: Mutex<Option<(Instant, OpencodeClient)>>,
    events: broadcast::Sender<serde_json::Value>,
    push: Arc<PushStore>,
}

/// The served state: the opencode client cache, the event fan-out, and the
/// push store.
#[derive(Clone)]
pub struct AppState {
    inner: Arc<Inner>,
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

impl AppState {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Inner {
                opencode: Mutex::new(None),
                events: broadcast::channel(1024).0,
                push: Arc::new(PushStore::load()),
            }),
        }
    }

    /// The opencode service client, re-discovered at most every 30 seconds.
    async fn opencode(&self) -> Result<OpencodeClient, ApiError> {
        let mut slot = self.inner.opencode.lock().await;
        if let Some((discovered_at, client)) = slot.as_ref()
            && discovered_at.elapsed() < DISCOVERY_TTL
        {
            return Ok(client.clone());
        }
        let client = OpencodeClient::discover()
            .map_err(|error| ApiError::internal("opencode", error.to_string()))?;
        *slot = Some((Instant::now(), client.clone()));
        Ok(client)
    }

    fn subscribe_events(&self) -> broadcast::Receiver<serde_json::Value> {
        self.inner.events.subscribe()
    }

    fn broadcast_event(&self, value: serde_json::Value) {
        // No subscribers is not an error.
        let _ = self.inner.events.send(value);
    }

    fn push(&self) -> Arc<PushStore> {
        self.inner.push.clone()
    }
}

/// Build the router. `static_dir` is served as a fallback when present (the
/// built PWA); without it the API is all there is.
pub fn router(state: AppState, static_dir: Option<PathBuf>) -> Router {
    let app = Router::new()
        .route("/api/sessions", get(oc_sessions))
        .route("/api/events", get(oc_events))
        .route("/api/sessions/{id}/messages", get(oc_messages))
        .route("/api/sessions/{id}", delete(oc_delete_session))
        .route("/api/sessions/{id}/prompt", post(oc_prompt))
        .route("/api/sessions/{id}/permissions", get(oc_permissions))
        .route("/api/sessions/{id}/forms", get(oc_forms))
        .route(
            "/api/sessions/{id}/permissions/{request_id}/reply",
            post(oc_permission_reply),
        )
        .route(
            "/api/sessions/{id}/forms/{form_id}/reply",
            post(oc_form_reply),
        )
        .route("/api/push/key", get(push_key))
        .route("/api/push/subscribe", post(push_subscribe))
        .route("/api/push/test", post(push_test))
        .with_state(state);

    if let Some(dir) = static_dir {
        let index = dir.join("index.html");
        return app.fallback_service(
            tower_http::services::ServeDir::new(dir)
                .fallback(tower_http::services::ServeFile::new(index)),
        );
    }
    serve_embedded(app)
}

/// Attach the embedded PWA when the build has one.
#[cfg(has_web)]
fn serve_embedded(app: Router) -> Router {
    app.fallback(get(crate::web::serve))
}

#[cfg(not(has_web))]
fn serve_embedded(app: Router) -> Router {
    app
}

/// Bind the API, start the event relay, and serve until the process ends.
///
/// The bind address is the caller's; kelpie itself only ever passes loopback.
pub async fn serve(
    state: AppState,
    addr: SocketAddr,
    static_dir: Option<PathBuf>,
) -> std::io::Result<()> {
    tokio::spawn(event_bridge(state.clone()));

    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!("kelpie listening on http://{addr}");
    axum::serve(listener, router(state, static_dir)).await
}

/// Follow the opencode event stream, fan it out to browser subscribers, and
/// push the events that deserve a notification. It reconnects forever.
async fn event_bridge(state: AppState) {
    // session id → project basename, so an execution event (which carries no
    // `location`) costs one lookup, not one per turn.
    let mut project_cache: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    loop {
        let client = match state.opencode().await {
            Ok(client) => client,
            Err(_) => {
                tokio::time::sleep(Duration::from_secs(3)).await;
                continue;
            }
        };
        let response = match client.events().await {
            Ok(response) => response,
            Err(_) => {
                tokio::time::sleep(Duration::from_secs(3)).await;
                continue;
            }
        };
        tracing::info!("opencode event stream connected");

        let mut stream = response.bytes_stream();
        let mut buffer = String::new();
        while let Some(chunk) = stream.next().await {
            let Ok(bytes) = chunk else { break };
            buffer.push_str(&String::from_utf8_lossy(&bytes));
            for value in drain_sse(&mut buffer) {
                if let Some(notification) =
                    notification_for_event(&value, &client, &mut project_cache).await
                {
                    let store = state.push();
                    tokio::spawn(async move {
                        push::broadcast(&store, &notification).await;
                    });
                }
                state.broadcast_event(value);
            }
        }
        tracing::warn!("opencode event stream ended; reconnecting");
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
}

/// Pull complete `data:` frames out of an SSE buffer.
fn drain_sse(buffer: &mut String) -> Vec<serde_json::Value> {
    let mut out = Vec::new();
    while let Some(position) = buffer.find("\n\n") {
        let frame: String = buffer.drain(..position + 2).collect();
        let mut data = String::new();
        for line in frame.lines() {
            if let Some(rest) = line.strip_prefix("data:") {
                if !data.is_empty() {
                    data.push('\n');
                }
                data.push_str(rest.trim_start());
            }
        }
        if data.is_empty() {
            continue;
        }
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(&data) {
            out.push(value);
        }
    }
    out
}

// ── opencode pass-through ────────────────────────────────────────────────────

fn oc_error(error: crate::opencode::OpencodeError) -> ApiError {
    ApiError::internal("opencode", error.to_string())
}

/// Every session across every project — the cross-project list.
/// Every session across every project — the cross-project list. Each running
/// session carries `active: true`, so the client can mark it without a second
/// request.
async fn oc_sessions(State(state): State<AppState>) -> Result<Json<serde_json::Value>, ApiError> {
    let client = state.opencode().await?;
    let value = client.sessions(100).await.map_err(oc_error)?;
    let mut sessions = value.get("data").cloned().unwrap_or_else(|| json!([]));

    // A failure here just means nothing is marked running; the list still comes
    // back.
    if let Ok(active) = client.active_sessions().await
        && let Some(running) = active.get("data").and_then(|data| data.as_object())
        && let Some(list) = sessions.as_array_mut()
    {
        for session in list {
            if let Some(id) = session.get("id").and_then(|value| value.as_str())
                && running.contains_key(id)
            {
                session["active"] = json!(true);
            }
        }
    }

    Ok(Json(json!({
        "version": env!("CARGO_PKG_VERSION"),
        "sessions": sessions,
    })))
}

/// Server-sent events, forwarded from the opencode service. `?session=` narrows
/// to one session; without it every event is forwarded.
#[derive(Debug, Deserialize)]
struct EventsQuery {
    session: Option<String>,
}

async fn oc_events(
    State(state): State<AppState>,
    Query(query): Query<EventsQuery>,
) -> Sse<impl tokio_stream::Stream<Item = Result<Event, std::convert::Infallible>>> {
    let receiver = state.subscribe_events();
    let filter = query.session;
    let stream = BroadcastStream::new(receiver).filter_map(move |result| {
        let value = result.ok()?;
        if let Some(session) = &filter {
            let session_id = value
                .get("data")
                .and_then(|data| data.get("sessionID"))
                .and_then(|value| value.as_str());
            if session_id != Some(session.as_str()) {
                return None;
            }
        }
        let data = serde_json::to_string(&value).ok()?;
        Some(Ok(Event::default().event("oc").data(data)))
    });
    Sse::new(stream).keep_alive(KeepAlive::default())
}

async fn oc_messages(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let client = state.opencode().await?;
    Ok(Json(client.messages(&id, 200).await.map_err(oc_error)?))
}

/// Delete a session and its child sessions. Destructive and irreversible.
async fn oc_delete_session(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let client = state.opencode().await?;
    Ok(Json(client.delete_session(&id).await.map_err(oc_error)?))
}

#[derive(Debug, Deserialize)]
struct PromptBody {
    text: String,
    /// opencode `FileAttachment`s (`{ uri, name? }`).
    #[serde(default)]
    files: Vec<serde_json::Value>,
}

async fn oc_prompt(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<PromptBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let client = state.opencode().await?;
    Ok(Json(
        client
            .prompt(&id, &body.text, &body.files)
            .await
            .map_err(oc_error)?,
    ))
}

async fn oc_permissions(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let client = state.opencode().await?;
    Ok(Json(client.permissions(&id).await.map_err(oc_error)?))
}

async fn oc_forms(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let client = state.opencode().await?;
    Ok(Json(client.forms(&id).await.map_err(oc_error)?))
}

#[derive(Debug, Deserialize)]
struct PermissionReplyBody {
    decision: String,
    #[serde(default)]
    message: Option<String>,
}

async fn oc_permission_reply(
    State(state): State<AppState>,
    Path((id, request_id)): Path<(String, String)>,
    Json(body): Json<PermissionReplyBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let client = state.opencode().await?;
    Ok(Json(
        client
            .reply_permission(&id, &request_id, &body.decision, body.message.as_deref())
            .await
            .map_err(oc_error)?,
    ))
}

#[derive(Debug, Deserialize)]
struct FormReplyBody {
    answer: serde_json::Value,
}

async fn oc_form_reply(
    State(state): State<AppState>,
    Path((id, form_id)): Path<(String, String)>,
    Json(body): Json<FormReplyBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let client = state.opencode().await?;
    Ok(Json(
        client
            .reply_form(&id, &form_id, body.answer)
            .await
            .map_err(oc_error)?,
    ))
}

// ── Web Push ─────────────────────────────────────────────────────────────────

async fn push_key(State(state): State<AppState>) -> Json<serde_json::Value> {
    Json(json!({ "publicKey": state.push().public_key() }))
}

#[derive(Debug, Deserialize)]
struct SubscribeBody {
    endpoint: String,
    keys: SubscribeKeys,
}

#[derive(Debug, Deserialize)]
struct SubscribeKeys {
    p256dh: String,
    auth: String,
}

async fn push_subscribe(
    State(state): State<AppState>,
    Json(body): Json<SubscribeBody>,
) -> Json<serde_json::Value> {
    state.push().subscribe(Subscription {
        endpoint: body.endpoint,
        keys: crate::push::SubscriptionKeys {
            p256dh: body.keys.p256dh,
            auth: body.keys.auth,
        },
    });
    Json(json!({ "ok": true }))
}

async fn push_test(State(state): State<AppState>) -> Json<serde_json::Value> {
    let store = state.push();
    let subscriptions = store.subscriptions().len();
    let notification = Notification {
        title: "kelpie".to_string(),
        body: "テスト通知です。".to_string(),
        session_id: None,
        tag: "kelpie-test".to_string(),
    };
    tokio::spawn(async move {
        push::broadcast(&store, &notification).await;
    });
    Json(json!({ "ok": true, "subscriptions": subscriptions }))
}

/// The notification a blocking event deserves, or `None` for everything else.
async fn notification_for_event(
    value: &serde_json::Value,
    client: &OpencodeClient,
    cache: &mut std::collections::HashMap<String, String>,
) -> Option<Notification> {
    let kind = value.get("type")?.as_str()?;
    let data = value.get("data")?;
    let session_id = data
        .get("sessionID")
        .and_then(|value| value.as_str())
        .map(str::to_string);

    // The event carries the project directory when it has one. The execution
    // events do not, so fall back to the session (cached).
    let project = match project_from_event(value) {
        Some(project) => project,
        None => match &session_id {
            Some(id) => match cache.get(id) {
                Some(project) => project.clone(),
                None => {
                    let project = client
                        .session_directory(id)
                        .await
                        .and_then(|directory| basename(&directory))
                        .unwrap_or_else(|| "opencode".to_string());
                    cache.insert(id.clone(), project.clone());
                    project
                }
            },
            None => "opencode".to_string(),
        },
    };

    match kind {
        "permission.asked" => {
            let action = data
                .get("action")
                .and_then(|value| value.as_str())
                .unwrap_or("permission");
            let resources = data
                .get("resources")
                .and_then(|value| value.as_array())
                .map(|items| {
                    items
                        .iter()
                        .filter_map(|item| item.as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                })
                .unwrap_or_default();
            Some(Notification {
                title: format!("{project} · {action} の許可待ち"),
                body: if resources.is_empty() {
                    "許可を求めて待機中".to_string()
                } else {
                    resources
                },
                session_id,
                tag: "kelpie-permission".to_string(),
            })
        }
        "form.created" => Some(Notification {
            title: format!("{project} · 質問"),
            body: data
                .get("title")
                .and_then(|value| value.as_str())
                .unwrap_or("回答を待っています")
                .to_string(),
            session_id,
            tag: "kelpie-form".to_string(),
        }),
        // A turn finished. Per-session tag, so several turns collapse into the
        // latest one instead of stacking.
        "session.execution.succeeded" => Some(Notification {
            title: format!("{project} · 完了"),
            body: "応答が完了しました".to_string(),
            session_id: session_id.clone(),
            tag: format!("kelpie-done-{}", session_id.as_deref().unwrap_or("session")),
        }),
        "session.execution.failed" => Some(Notification {
            title: format!("{project} · 失敗"),
            body: "実行が失敗しました".to_string(),
            session_id: session_id.clone(),
            tag: format!("kelpie-fail-{}", session_id.as_deref().unwrap_or("session")),
        }),
        _ => None,
    }
}

/// The project basename an event's own `location` names, when it has one.
fn project_from_event(value: &serde_json::Value) -> Option<String> {
    value
        .get("location")
        .and_then(|location| location.get("directory"))
        .and_then(|value| value.as_str())
        .and_then(basename)
}

/// The last path segment, ignoring a trailing slash.
fn basename(path: &str) -> Option<String> {
    path.trim_end_matches('/')
        .rsplit('/')
        .next()
        .filter(|segment| !segment.is_empty())
        .map(str::to_string)
}

/// A JSON error body: a stable `code` the phone translates, and a message.
pub struct ApiError {
    status: StatusCode,
    code: &'static str,
    message: String,
}

impl ApiError {
    fn internal(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            code,
            message: message.into(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(json!({ "code": self.code, "message": self.message })),
        )
            .into_response()
    }
}
