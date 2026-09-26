# kelpie

[日本語](README.ja.md)

Drive an [opencode](https://opencode.ai) server from your phone as a chat app, over Tailscale.
Named after the Australian Kelpie (a dog).

Its concept and UI are heavily inspired by [collie](https://github.com/AltanS/collie) — an
earlier take on the same problem, driving coding agents over a tailnet.

- **Every project in one list** with read/unread and waiting confirmations at a glance, a
  ChatGPT-style mobile GUI, token-by-token streaming
- **Answer permissions and questions from your phone**, plus **Web Push notifications**
  (permission prompts, questions, finished turns)
- Uses opencode v2's **HTTP API and nothing else** — no screen scraping, no log parsing,
  no keystrokes

Docs: <https://yumazak.github.io/kelpie/> (source in `docs/`)

## Running it

```bash
cargo build --release
pnpm --dir crates/kelpie/web install
pnpm --dir crates/kelpie/web build
./target/release/kelpie serve --port 7180 --static-dir "$PWD/crates/kelpie/web/dist"
```

- opencode v2 must be running (`opencode` or `opencode service start`)
- publish `127.0.0.1:7180` to your tailnet with `tailscale serve`
- open it on your phone and tap “Enable notifications” (on iOS you have to add it to
  the home screen first)

While developing, use the web dev server (it proxies `/api` to 7180):

```bash
cargo run -p kelpie -- serve --port 7180
pnpm --dir crates/kelpie/web dev
```

## Install (macOS / Apple Silicon)

Prebuilt binaries are attached to [GitHub Releases](https://github.com/yumazak/kelpie/releases).
Installing through mise keeps them up to date too.

```bash
mise use -g github:yumazak/kelpie
kelpie service install --port 7180
```

## Releases

Pushing to `main` makes [release-plz](https://release-plz.dev) open and update a
**release PR** (version + `CHANGELOG.md`). Merging that PR is the only thing that
creates a tag and a GitHub Release, with the macOS binary attached.

See [`RELEASING.md`](./RELEASING.md) for the details.

The CLI, the macOS service and the design are in the [docs](https://yumazak.github.io/kelpie/).
Requirements: opencode v2 / Tailscale / Rust 1.98+ and pnpm 12 to build.

## Credits

- [collie](https://github.com/AltanS/collie) — a mobile PWA for driving coding agents over a
  tailnet. kelpie's concept, its UI and the mark's design are heavily influenced by it.
