# kelpie

[日本語](README.ja.md)

Drive an [opencode](https://opencode.ai) server from your phone as a chat app, over Tailscale.
Named after the Australian Kelpie (a dog).

- **Every project in one list**, a ChatGPT-style mobile GUI, token-by-token streaming
- **Answer permissions and questions from your phone**, plus **Web Push notifications**
  (permission prompts, questions, finished turns)
- Uses opencode v2's **HTTP API and nothing else** — no screen scraping, no log parsing,
  no keystrokes

Docs: <https://yumazak.github.io/kelpie/> (source in `docs/`)

## Running it

```bash
cargo build --release
cd web && pnpm install && pnpm build && cd ..
./target/release/kelpie serve --port 7180 --static-dir "$PWD/web/dist"
```

- opencode v2 must be running (`opencode` or `opencode service start`)
- publish `127.0.0.1:7180` to your tailnet with `tailscale serve`
- open it on your phone and tap “Enable notifications” (on iOS you have to add it to
  the home screen first)

The CLI, the macOS service and the design are in the [docs](https://yumazak.github.io/kelpie/).
Requirements: opencode v2 / Tailscale / Rust 1.98+ and pnpm 12 to build.
