---
title: Guide
description: How kelpie is put together, how to run it, the CLI, and the macOS service.
---

## Layout

- **Rust** (`crates/kelpie`, `crates/kelpie-cli`) … opencode client, SSE relay, Web Push
- **TypeScript** (`web/`) … React + Vite + Tailwind + assistant-ui

```
phone (PWA) ── HTTPS ──▶ tailscale serve ──▶ kelpie (127.0.0.1) ──▶ opencode service
```

## Running it

```bash
cargo build --release
cd web && pnpm install && pnpm build && cd ..
./target/release/kelpie serve --port 7180 --static-dir "$PWD/web/dist"
```

- opencode must be running (`opencode` or `opencode service start`)
- publish `127.0.0.1:7180` to your tailnet with `tailscale serve`
- open it on your phone and tap “Enable notifications” (on iOS you have to add it to
  the home screen first)

While developing, use the web dev server (it proxies `/api` to 7180):

```bash
cargo run -p kelpie-cli -- serve --port 7180
cd web && pnpm dev
```

## Commands

```bash
kelpie serve [--port N] [--static-dir DIR]
kelpie sessions [--limit N]      # sessions across every project
kelpie messages <id> [--json]    # a conversation
kelpie push-test                 # send a test notification
kelpie doctor                    # diagnose the environment (opencode / push / state)
kelpie service install           # run as a service (macOS LaunchAgent)
kelpie service status
kelpie service uninstall
```

## As a service (macOS)

```bash
kelpie service install --port 7180
kelpie service restart
kelpie service status
```

- Writes `~/Library/LaunchAgents/dev.kelpie.serve.plist` and registers it with
  `launchctl bootstrap`
- **Starts at login**, and launchd restarts it if it dies (`KeepAlive`)
- **Updates need no hands**: the plist watches the binary and restarts the service
  when it changes (every 5 minutes by default, `KELPIE_RESTART_CHECK_SECS` to change
  that). `mise install` is all it takes to move to a new build
- Run `kelpie service restart` to swap in a build explicitly
- Logs: `~/.local/state/kelpie/serve.log`
- `launchd` runs with a minimal environment, so the plist embeds `PATH` (mise shims /
  Homebrew)
- Installed through mise it points at the `latest` symlink, so it follows
  `mise upgrade`
- Remove it with `kelpie service uninstall`

## Requirements

- opencode v2 (`opencode service status` returns a URL)
- Tailscale (published with `tailscale serve`)
- Building: Rust 1.98+, pnpm 12 (web)
