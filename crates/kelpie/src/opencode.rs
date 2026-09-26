//! The opencode v2 client.
//!
//! opencode v2 runs a **background service** that owns every session, and its
//! clients (TUI, web, CLI) connect to it. kelpie is one more client: it reads
//! the service URL from `opencode service status` and the Basic-auth password
//! from `~/.config/opencode/service.json`, then talks to the HTTP API.
//!
//! This is the whole integration surface — no terminal, no log parsing, no
//! keystrokes. `GET /api/session` lists every session across every project,
//! `GET /api/session/{id}/message` returns structured messages, and
//! `GET /api/event` streams.

use std::path::PathBuf;
use std::time::Duration;

use serde_json::Value;

pub mod discovery;

/// How long one HTTP call may take. The service is local.
const TIMEOUT: Duration = Duration::from_secs(15);

/// A connection to one opencode service.
#[derive(Debug, Clone)]
pub struct OpencodeClient {
    base_url: String,
    password: Option<String>,
    /// The ordinary client: every call is bounded by `TIMEOUT`.
    http: reqwest::Client,
    /// A second client with no total timeout, for the long-lived SSE stream.
    /// reqwest's timeout is a *whole-response* budget, so sharing the bounded
    /// client severed `/api/event` every 15 seconds and left a gap in which an
    /// event — and any notification it deserved — could be lost.
    events_http: reqwest::Client,
}

#[derive(Debug, thiserror::Error)]
pub enum OpencodeError {
    #[error("opencode service not found (is `opencode service start` running?)")]
    NotFound,
    #[error("opencode http: {0}")]
    Http(#[from] reqwest::Error),
    #[error("opencode json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("opencode returned {status}: {body}")]
    Status { status: u16, body: String },
}

impl OpencodeClient {
    /// Connect using the discovered service. `None` when no service is running.
    pub fn discover() -> Result<Self, OpencodeError> {
        let base_url = discovery::service_url().ok_or(OpencodeError::NotFound)?;
        let password = discovery::service_password();
        Self::new(base_url, password)
    }

    pub fn new(
        base_url: impl Into<String>,
        password: Option<String>,
    ) -> Result<Self, OpencodeError> {
        let http = reqwest::Client::builder().timeout(TIMEOUT).build()?;
        // No total timeout: the SSE stream lives as long as the service does.
        // TCP keepalive still surfaces a half-open socket.
        let events_http = reqwest::Client::builder()
            .tcp_keepalive(Duration::from_secs(30))
            .build()?;
        Ok(Self {
            base_url: base_url.into().trim_end_matches('/').to_string(),
            password,
            http,
            events_http,
        })
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    fn request_with(
        &self,
        http: &reqwest::Client,
        method: reqwest::Method,
        path: &str,
    ) -> reqwest::RequestBuilder {
        let url = format!("{}{}", self.base_url, path);
        let mut request = http.request(method, url);
        // The username is fixed; only the password is per-install.
        if let Some(password) = &self.password {
            request = request.basic_auth("opencode", Some(password));
        }
        request
    }

    fn request(&self, method: reqwest::Method, path: &str) -> reqwest::RequestBuilder {
        self.request_with(&self.http, method, path)
    }

    async fn json(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<Value>,
    ) -> Result<Value, OpencodeError> {
        let mut request = self.request(method, path);
        if let Some(body) = body {
            request = request.json(&body);
        }
        self.send_json(request).await
    }

    /// Send a prepared request and decode the JSON body. Split from `json` so
    /// the query-string calls (`skills`) can build their own request.
    async fn send_json(&self, request: reqwest::RequestBuilder) -> Result<Value, OpencodeError> {
        let response = request.send().await?;
        let status = response.status();
        let text = response.text().await?;
        if !status.is_success() {
            return Err(OpencodeError::Status {
                status: status.as_u16(),
                body: text,
            });
        }
        if text.is_empty() {
            return Ok(Value::Null);
        }
        Ok(serde_json::from_str(&text)?)
    }

    /// Every session, across every project, newest first. `cursor` is the
    /// opaque page token the service returns as `cursor.next`.
    pub async fn sessions(&self, limit: u32, cursor: Option<&str>) -> Result<Value, OpencodeError> {
        let mut path = format!("/api/session?limit={limit}&order=desc");
        if let Some(cursor) = cursor {
            // The token is base64url (URL-safe), so it needs no escaping.
            path.push_str("&cursor=");
            path.push_str(cursor);
        }
        self.json(reqwest::Method::GET, &path, None).await
    }

    /// One session, by id. Used to open the session a notification links to
    /// when it is not on the first page of the list.
    pub async fn session(&self, session_id: &str) -> Result<Value, OpencodeError> {
        self.json(
            reqwest::Method::GET,
            &format!("/api/session/{session_id}"),
            None,
        )
        .await
    }

    /// One session's messages, oldest first.
    ///
    /// The service caps `limit` at 200 and pages from the END of the log, so
    /// asking ascending returns the OLDEST 200 and silently drops every newer
    /// turn. Fetch descending (the newest 200) and reverse, so a reload always
    /// lands on the live end of the conversation.
    pub async fn messages(&self, session_id: &str, limit: u32) -> Result<Value, OpencodeError> {
        let mut value = self
            .json(
                reqwest::Method::GET,
                &format!("/api/session/{session_id}/message?limit={limit}&order=desc"),
                None,
            )
            .await?;
        if let Some(data) = value.get_mut("data").and_then(|data| data.as_array_mut()) {
            data.reverse();
        }
        Ok(value)
    }

    /// Sessions with a turn in flight. `{ ses_id: { type: "running" } }`.
    pub async fn active_sessions(&self) -> Result<Value, OpencodeError> {
        self.json(reqwest::Method::GET, "/api/session/active", None)
            .await
    }

    /// Interrupt the running turn (the session goes back to idle).
    pub async fn interrupt_session(&self, session_id: &str) -> Result<Value, OpencodeError> {
        self.json(
            reqwest::Method::POST,
            &format!("/api/session/{session_id}/interrupt"),
            None,
        )
        .await
    }

    /// Delete a session and its child sessions.
    pub async fn delete_session(&self, session_id: &str) -> Result<Value, OpencodeError> {
        self.json(
            reqwest::Method::DELETE,
            &format!("/api/session/{session_id}"),
            None,
        )
        .await
    }

    /// The directory a session ran in, when the service reports one. Used to
    /// name the project on a notification for an event that carries no
    /// `location` (the execution events do not).
    pub async fn session_directory(&self, session_id: &str) -> Option<String> {
        let value = self
            .json(
                reqwest::Method::GET,
                &format!("/api/session/{session_id}"),
                None,
            )
            .await
            .ok()?;
        value
            .get("data")
            .and_then(|data| data.get("location"))
            .and_then(|location| location.get("directory"))
            .and_then(|value| value.as_str())
            .map(str::to_string)
    }

    /// Every skill registered for `directory` (a project). The service searches
    /// from that directory up to the project root, so a session's own location
    /// is the right scope; without one its default location is used.
    ///
    /// opencode takes the scope as a `location[directory]` deepObject query
    /// parameter; `reqwest` percent-encodes the brackets, which the service
    /// accepts.
    pub async fn skills(&self, directory: Option<&str>) -> Result<Value, OpencodeError> {
        let mut request = self.request(reqwest::Method::GET, "/api/skill");
        if let Some(directory) = directory {
            request = request.query(&[("location[directory]", directory)]);
        }
        self.send_json(request).await
    }

    /// Send a prompt to a session. `files` are opencode `FileAttachment`s:
    /// `{ uri, name?, description? }`, where `uri` is a `file://` URL or a
    /// `data:` URL. `skills` are `Prompt.SkillAttachment`s (`{ id }`); the
    /// service inlines each skill's body into the turn.
    pub async fn prompt(
        &self,
        session_id: &str,
        text: &str,
        files: &[Value],
        skills: &[Value],
    ) -> Result<Value, OpencodeError> {
        let mut body = serde_json::json!({ "text": text });
        if !files.is_empty() {
            body["files"] = Value::Array(files.to_vec());
        }
        if !skills.is_empty() {
            body["skills"] = Value::Array(skills.to_vec());
        }
        self.json(
            reqwest::Method::POST,
            &format!("/api/session/{session_id}/prompt"),
            Some(body),
        )
        .await
    }

    /// The service's global event stream (SSE). Read it with `bytes_stream()`.
    ///
    /// Sent on the untimed `events_http` client: the stream is long-lived, so
    /// the bounded `http` client would cut it off at `TIMEOUT`.
    pub async fn events(&self) -> Result<reqwest::Response, OpencodeError> {
        let response = self
            .request_with(&self.events_http, reqwest::Method::GET, "/api/event")
            .send()
            .await?;
        if !response.status().is_success() {
            return Err(OpencodeError::Status {
                status: response.status().as_u16(),
                body: String::new(),
            });
        }
        Ok(response)
    }

    /// Pending permission requests for a session.
    pub async fn permissions(&self, session_id: &str) -> Result<Value, OpencodeError> {
        self.json(
            reqwest::Method::GET,
            &format!("/api/session/{session_id}/permission"),
            None,
        )
        .await
    }

    /// Pending forms (opencode v2's ask-the-user mechanism) for a session.
    pub async fn forms(&self, session_id: &str) -> Result<Value, OpencodeError> {
        self.json(
            reqwest::Method::GET,
            &format!("/api/session/{session_id}/form"),
            None,
        )
        .await
    }

    /// Answer a pending permission request. `decision` is `once` / `always` /
    /// `reject`.
    pub async fn reply_permission(
        &self,
        session_id: &str,
        request_id: &str,
        decision: &str,
        message: Option<&str>,
    ) -> Result<Value, OpencodeError> {
        let mut body = serde_json::json!({ "decision": decision });
        if let Some(message) = message {
            body["message"] = serde_json::json!(message);
        }
        self.json(
            reqwest::Method::POST,
            &format!("/api/session/{session_id}/permission/{request_id}/reply"),
            Some(body),
        )
        .await
    }

    /// Answer a pending form (opencode v2's ask-the-user mechanism). `answer`
    /// maps each field id to its value.
    pub async fn reply_form(
        &self,
        session_id: &str,
        form_id: &str,
        answer: Value,
    ) -> Result<Value, OpencodeError> {
        self.json(
            reqwest::Method::POST,
            &format!("/api/session/{session_id}/form/{form_id}/reply"),
            Some(serde_json::json!({ "answer": answer })),
        )
        .await
    }
}

/// The v2 service writes its password here (mode 0600).
pub fn service_config_path() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    Some(PathBuf::from(home).join(".config/opencode/service.json"))
}
