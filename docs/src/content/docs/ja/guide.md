---
title: 使い方
description: kelpie の構成、インストール、動かし方、コマンド、常駐化、要件。
---

## 構成

- **Rust**（`crates/kelpie`）… 1クレート。opencode クライアント、SSE 中継、Web Push、CLI
- **TypeScript**（`crates/kelpie/web`）… React + Vite + Tailwind + assistant-ui

```
スマホ (PWA) ── HTTPS ──▶ tailscale serve ──▶ kelpie (127.0.0.1) ──▶ opencode サービス
```

## インストール（macOS / Apple Silicon）

[GitHub Releases](https://github.com/yumazak/kelpie/releases) にビルド済みバイナリを置いています。mise で入れると更新も追従します。

```bash
mise use -g github:yumazak/kelpie
kelpie service install --port 7180
```

## ソースからビルドして動かす

```bash
cargo build --release
pnpm --dir crates/kelpie/web install
pnpm --dir crates/kelpie/web build
./target/release/kelpie serve --port 7180 --static-dir "$PWD/crates/kelpie/web/dist"
```

- opencode のサービスが動いていること（`opencode` か `opencode service start`）
- `tailscale serve` で `127.0.0.1:7180` を tailnet に公開
- スマホで開き、「通知を有効にする」をタップ（iOS はホーム画面追加が必須）

開発中は web の dev server を使う（`/api` は 7180 にプロキシ）:

```bash
cargo run -p kelpie -- serve --port 7180
pnpm --dir crates/kelpie/web dev
```

## コマンド

```bash
kelpie serve [--port N] [--static-dir DIR]
kelpie sessions [--limit N]      # 全プロジェクトのセッション
kelpie messages <id> [--json]    # 会話
kelpie push-test                 # テスト通知
kelpie doctor                    # 環境診断（opencode 接続 / 通知 / state）
kelpie service install           # 常駐化（macOS LaunchAgent）
kelpie service status
kelpie service uninstall
```

## 常駐化（macOS）

```bash
kelpie service install --port 7180
kelpie service restart
kelpie service status
```

- `~/Library/LaunchAgents/dev.kelpie.serve.plist` を書き、`launchctl bootstrap` で登録します
- **ログイン時に自動起動**、落ちても launchd が再起動（KeepAlive）
- **更新はゼロタッチ**: plist がバイナリを監視し、変わったら自分で再起動します（既定5分ごと、`KELPIE_RESTART_CHECK_SECS` で変更可）。`mise install` だけで最新に追従します
- 明示的に入れ替えたいときは `kelpie service restart`
- ログ: `~/.local/state/kelpie/serve.log`
- `launchd` は環境が最小なので、plist に `PATH`（mise shims / Homebrew）を埋め込みます
- mise で入れた場合は `latest` シンボリックリンクを指すので、`mise upgrade` に追従します
- 外す: `kelpie service uninstall`

## リリース

`main` に push すると [release-plz](https://release-plz.dev) がリリースPRを作成・更新し、それをマージしたときにタグと GitHub Release が作られます。詳しくは [`RELEASING.md`](https://github.com/yumazak/kelpie/blob/main/RELEASING.md) を参照。

## 要件

- opencode v2（`opencode service status` が URL を返すこと）
- Tailscale（`tailscale serve` で公開）
- ビルド: Rust 1.98+、pnpm 12
