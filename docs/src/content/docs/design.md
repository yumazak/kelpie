---
title: Design
description: How kelpie is designed around opencode v2, and why.
---

> Drive an opencode server from your phone as a chat app, over Tailscale.
> Named after the Australian Kelpie (a dog).

## 0. Decisions

| Question | Decision |
| --- | --- |
| Target | **opencode v2 only**. Not herdr, not any other harness |
| Implementation | **Rust (bridge / CLI) + TypeScript (`crates/kelpie/web`)** |
| Integration surface | opencode v2's **HTTP API + SSE** (no screen scraping, no log parsing, no keystrokes) |
| UI | ChatGPT-style mobile GUI (assistant-ui). Dark, always |
| Session list | **Across every project** (`GET /api/session`). Read/unread comes from opencode's `time.idle` / `time.viewed` |
| Dialogs | Answer permissions and forms structurally, through the API |
| Notifications | Web Push (VAPID). `permission.asked` / `form.created` / `session.execution.*` |
| License | Open source (MIT) |

## 1. Why opencode only

opencode v2 is a **server plus clients**: the TUI, the web UI and the IDE plugins are
all just clients of the same server. That means everything an external client needs is
already there:

| What you need | opencode v2's API |
| --- | --- |
| Session list (all projects) | `GET /api/session` |
| Conversation (structured) | `GET /api/session/{id}/message` |
| Streaming | `GET /api/event` (`session.text.delta` and friends) |
| Sending | `POST /api/session/{id}/prompt` |
| Repository (worktrees) / main checkout | `GET /api/project` / `GET /api/worktree` |
| Permissions | `GET /api/session/{id}/permission` / `POST .../reply` |
| Questions (forms) | `GET /api/session/{id}/form` / `POST .../reply` |
| Read state | `POST /api/session/{id}/view` (records the `time.idle` the client displayed) |
| Pending confirmations | `GET /api/permission/request` / `GET /api/form` (per location, matched by `sessionID`) |

TUI-only harnesses (claude / codex / pi) can only read the screen and send keystrokes,
which gets you neither streaming nor structured dialogs. opencode makes that
unnecessary, so **the same goal takes far less machinery**. herdr (a multiplexer) is
also gone: opencode detects, owns and exposes the server itself.

## 2. Architecture

```
   phone / tablet (PWA)
        │  HTTPS (tailnet only)          https://kelpie.<tailnet>.ts.net
        ▼
   tailscale serve            TLS termination (proxies to loopback)
        │  127.0.0.1:7180      kelpie binds loopback only
        ▼
   kelpie (Rust, one binary)
     ├─ static PWA (crates/kelpie/web/dist) + JSON API
     ├─ opencode client : calls /api/* with Basic auth
     ├─ event bridge    : subscribes to GET /api/event (SSE) → relays to the browser
     ├─ push            : VAPID + subscription store + Web Push
     └─ state           : ~/.local/state/kelpie/push.json
        │  HTTP (127.0.0.1:49374 and up)
        ▼
   opencode v2 background service
     └─ owns every project's sessions. The TUI, the web UI and kelpie are all clients
```

- **kelpie is one client of opencode**. It owns no process and no PTY.
- You can watch **the same session** in the terminal and on your phone at once — both
  are clients of the server.
- Notifications do not care where the prompt came from (phone, terminal or CLI).

## 3. Talking to opencode

- **URL**: `opencode service status` prints `http://127.0.0.1:<port>` (the port changes
  on restart, so it is re-discovered every 30 seconds)
- **Auth**: Basic auth with the `password` from `~/.config/opencode/service.json`
  (the username is `opencode`)
- **Events**: `GET /api/event` is SSE. Read `data: {...}\n\n` and dispatch on `type`

The events that matter:

| Event | Used for |
| --- | --- |
| `session.text.started` / `.delta` / `.ended` | streaming the reply |
| `session.reasoning.*` | streaming the model's reasoning |
| `session.tool.*` | tool calls |
| `session.execution.succeeded` / `.failed` | turn finished (notify) |
| `permission.asked` | permission prompt (notify + dock) |
| `form.created` | question (notify + dock) |

## 4. UI

- **Home**: every session, grouped by **repository** and then by the **directory
  (worktree)** it ran in. The worktrees of one repository share an opencode
  `projectID`, and the repository is named by the basename of its main checkout (the
  directory `GET /api/worktree` lists without a `strategy`). Status dot, relative time.
- **Read / unread / waiting**: the dot on the left carries the state. Unread
  (`time.idle` > `time.viewed`) is green; read has no dot. A session stopped on a
  permission or a question is orange; a running one is blue (pulsing). Opening the chat
  posts the `idle` it displayed to `POST /api/session/{id}/view`, and re-posts whenever
  a turn finishes while the chat is open. opencode shares `viewed`, so reading in the
  TUI clears the marker here too.
- **Finding the waiters**: permissions and forms are location-scoped in opencode (the
  directory a session runs in), so building the list asks `GET /api/permission/request`
  and `GET /api/form` once per directory on the page and matches them by `sessionID`.
- **Chat**: assistant-ui's styled `Thread`. Conversations render opencode's messages as
  they are (`user` → bubble, assistant `text` → markdown, `reasoning` → collapsible,
  `tool` → card).
- **Streaming**: accumulate `session.text.delta` and render the reply as it arrives.
  Re-fetch the authoritative list on `step.ended`. A 2-second poll is the fallback.
- **HarnessDock**: pinned above the composer.
  - permission → “Allow / Always allow / Deny”
  - form → renders the fields (string / number / boolean / multiselect)
- **Skills**: from the composer's picker, choose a skill that applies to the session's
  directory (`GET /api/skill`, filtered by `location[directory]`) and attach it to the
  next message as `skills: [{ id }]`. Chosen skills show up as chips above the composer.
  Loading a skill shows up as a `skill` message in a tool card (`convert.ts`).

## 5. Notifications

- The **VAPID** key pair is generated on first start (`p256`,
  `~/.local/state/kelpie/push.json`)
- Device subscriptions are stored and sent to with `web-push` (`urgency: high`, TTL 6h;
  404/410 responses drop the subscription)
- Triggers: `permission.asked` / `form.created` / `session.execution.succeeded` /
  `.failed`
- The title starts with the **repository name** — the main checkout's basename, not a
  worktree's branch, resolved from the session's `projectID` through
  `GET /api/worktree` and cached per session and per project
- The body says **what is being asked** (for permissions: action + resources; for
  forms: the question)
- Tapping a notification opens that session. iOS sometimes drops URL query strings, so
  the service worker stashes the session ID in Cache Storage and the app reads it on
  start

## 6. Setup / operations

```bash
cargo build --release
pnpm --dir crates/kelpie/web install
pnpm --dir crates/kelpie/web build
./target/release/kelpie serve --port 7180 --static-dir "$PWD/crates/kelpie/web/dist"
```

- opencode has to be running (`opencode service start` / starting the TUI)
- publish loopback to your tailnet with `tailscale serve` (kelpie does not configure it)
- on your phone, tap “Enable notifications” (on iOS you have to add it to the home
  screen first)

## 7. Security

- kelpie binds **`127.0.0.1` only**. The front door is `tailscale serve`
- opencode's Basic credentials are read by kelpie and never handed to the browser
- Pane output from the PWA is rendered as React text nodes (`innerHTML` is banned)
- `tailscale funnel` is not allowed
