# kelpie

[opencode](https://opencode.ai) のサーバを、Tailscale 越しにスマホのチャットアプリとして操作する。
名前は Australian Kelpie（犬）より。

- **全プロジェクト横断**のセッション一覧（opencode の API から）
- ChatGPT 風のモバイルチャット GUI（[assistant-ui](https://www.assistant-ui.com/)、ダーク固定）
- **トークン単位のストリーミング**（opencode の SSE を中継）
- **権限 / 質問をスマホから回答**（permission の許可・拒否、form の入力）
- **Web Push 通知**（許可待ち / 質問 / 完了）
- opencode v2 の **HTTP API だけ**を使う。画面スクレイプ・ログ解析・キー送信なし

設計は [`DESIGN.md`](./DESIGN.md) を参照。

## 構成

- **Rust**（`crates/kelpie`, `crates/kelpie-cli`）… opencode クライアント、SSE 中継、Web Push
- **TypeScript**（`web/`）… React + Vite + Tailwind + assistant-ui

```
スマホ (PWA) ── HTTPS ──▶ tailscale serve ──▶ kelpie (127.0.0.1) ──▶ opencode サービス
```

## 動かす

```bash
cargo build --release
cd web && pnpm install && pnpm build && cd ..
./target/release/kelpie serve --port 7180 --static-dir "$PWD/web/dist"
```

- opencode のサービスが動いていること（`opencode` か `opencode service start`）
- `tailscale serve` で `127.0.0.1:7180` を tailnet に公開
- スマホで開き、「通知を有効にする」をタップ（iOS はホーム画面追加が必須）

開発中は web の dev server を使う（`/api` は 7180 にプロキシ）:

```bash
cargo run -p kelpie-cli -- serve --port 7180
cd web && pnpm dev
```

## コマンド

```bash
kelpie serve [--port N] [--static-dir DIR]
kelpie sessions [--limit N]      # 全プロジェクトのセッション
kelpie messages <id> [--json]    # 会話
kelpie push-test                 # テスト通知
kelpie doctor                    # 環境診断（opencode 接続 / 通知 / state）
```

## 要件

- opencode v2（`opencode service status` が URL を返すこと）
- Tailscale（`tailscale serve` で公開）
- ビルド: Rust 1.96+、Bun/pnpm（web）
