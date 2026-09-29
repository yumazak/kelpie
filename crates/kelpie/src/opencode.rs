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

    /// Mark the idle transition a viewer has observed as viewed. `idle` is the
    /// session's `time.idle` at the moment the client displayed it; the service
    /// records it as `time.viewed`, which is what makes a session "read" for
    /// every client. Responds with no content.
    pub async fn view_session(&self, session_id: &str, idle: f64) -> Result<Value, OpencodeError> {
        self.json(
            reqwest::Method::POST,
            &format!("/api/session/{session_id}/view"),
            Some(serde_json::json!({ "idle": idle })),
        )
        .await
    }

    /// One session's messages, oldest first.
    ///
    /// The service caps `limit` at 200 and pages from the END of the log, so
    /// asking ascending returns the OLDEST 200 and silently drops every newer
    /// turn. Fetch descending (the newest 200) and reverse, so a reload always
    /// lands on the live end of the conversation.
    pub async fn messages(
        &self,
        session_id: &str,
        limit: u32,
        cursor: Option<&str>,
    ) -> Result<Value, OpencodeError> {
        // The service rejects `cursor` together with `order`, so `order` is only
        // sent for the first (newest) page. A cursor carries its own direction,
        // which pages towards older messages.
        let mut path = format!("/api/session/{session_id}/message?limit={limit}");
        match cursor {
            Some(cursor) => {
                path.push_str("&cursor=");
                path.push_str(cursor);
            }
            None => path.push_str("&order=desc"),
        }
        let mut value = self.json(reqwest::Method::GET, &path, None).await?;
        if let Some(data) = value.get_mut("data").and_then(|data| data.as_array_mut()) {
            data.reverse();
            // Each assistant message carries a git `snapshot`: the working-tree
            // file list at that turn, which can be megabytes (a `web/dist`
            // build alone blows it up). The phone never renders it, so drop it
            // before it crosses the wire.
            for message in data.iter_mut() {
                if let Some(object) = message.as_object_mut() {
                    object.remove("snapshot");
                }
            }
        }
        Ok(value)
    }

    /// Every project opencode knows, across every repository.
    pub async fn projects(&self) -> Result<Value, OpencodeError> {
        self.json(reqwest::Method::GET, "/api/project", None).await
    }

    /// One project's worktree inventory. The entry with no `strategy` is the
    /// main checkout; the rest are worktrees (`strategy: "git"`). Its basename
    /// is the repository name.
    pub async fn worktrees(&self, project_id: &str) -> Result<Value, OpencodeError> {
        let request = self
            .request(reqwest::Method::GET, "/api/worktree")
            .query(&[("projectID", project_id)]);
        self.send_json(request).await
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

    /// Pending permission requests for a location (the directory a session runs
    /// in). opencode scopes these by location, not globally, so a directory the
    /// service no longer knows is an error the caller ignores.
    pub async fn pending_permissions(&self, directory: &str) -> Result<Value, OpencodeError> {
        let request = self
            .request(reqwest::Method::GET, "/api/permission/request")
            .query(&[("location[directory]", directory)]);
        self.send_json(request).await
    }

    /// Pending forms (opencode's ask-the-user mechanism) for a location.
    pub async fn pending_forms(&self, directory: &str) -> Result<Value, OpencodeError> {
        let request = self
            .request(reqwest::Method::GET, "/api/form")
            .query(&[("location[directory]", directory)]);
        self.send_json(request).await
    }

    /// Send a prompt to a session. `files` are opencode `FileAttachment`s:
    /// `{ uri, name?, description? }`, where `uri` is a `file://` URL or a
    /// `data:` URL. `skills` are `Prompt.SkillAttachment`s (`{ id }`); the
    /// service inlines each skill's body into the turn.
    ///
    /// `delivery` is opencode's `Session.Inbox.Delivery`, which decides what a
    /// prompt sent while a turn is in flight does: `"queue"` waits for the turn
    /// to finish, `"steer"` interrupts it. `None` lets the service decide, which
    /// is what an idle session wants.
    pub async fn prompt(
        &self,
        session_id: &str,
        text: &str,
        files: &[Value],
        skills: &[Value],
        delivery: Option<&str>,
    ) -> Result<Value, OpencodeError> {
        let mut body = serde_json::json!({ "text": text });
        if !files.is_empty() {
            body["files"] = Value::Array(files.to_vec());
        }
        if !skills.is_empty() {
            body["skills"] = Value::Array(skills.to_vec());
        }
        if let Some(delivery) = delivery {
            body["delivery"] = Value::String(delivery.to_string());
        }
        self.json(
            reqwest::Method::POST,
            &format!("/api/session/{session_id}/prompt"),
            Some(body),
        )
        .await
    }

    /// A session's inbox: prompts admitted while a turn was in flight, waiting
    /// for their turn. The service owns this queue — every client shares it —
    /// so the phone renders it instead of holding prompts of its own.
    pub async fn inbox(&self, session_id: &str) -> Result<Value, OpencodeError> {
        self.json(
            reqwest::Method::GET,
            &format!("/api/session/{session_id}/inbox"),
            None,
        )
        .await
    }

    /// Drop one pending prompt from a session's inbox.
    pub async fn cancel_inbox(
        &self,
        session_id: &str,
        inbox_id: &str,
    ) -> Result<Value, OpencodeError> {
        self.json(
            reqwest::Method::DELETE,
            &format!("/api/session/{session_id}/inbox/{inbox_id}"),
            None,
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
