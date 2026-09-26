# kelpie

[opencode](https://opencode.ai) のサーバを、Tailscale 越しにスマホのチャットアプリとして操作する。
名前は Australian Kelpie（犬）より。

- **全プロジェクト横断**のセッション一覧、ChatGPT 風のモバイル GUI、トークン単位のストリーミング
- **権限 / 質問をスマホから回答**、**Web Push 通知**（許可待ち / 質問 / 完了）
- opencode v2 の **HTTP API だけ**を使う。画面スクレイプ・ログ解析・キー送信なし

ドキュメント: <https://yumazak.github.io/kelpie/>（ソースは `docs/`）

## 動かす

```bash
cargo build --release
cd web && pnpm install && pnpm build && cd ..
./target/release/kelpie serve --port 7180 --static-dir "$PWD/web/dist"
```

- opencode v2 のサービスが動いていること（`opencode` か `opencode service start`）
- `tailscale serve` で `127.0.0.1:7180` を tailnet に公開
- スマホで開き、「通知を有効にする」をタップ（iOS はホーム画面追加が必須）

コマンド・常駐化・設計は[ドキュメント](https://yumazak.github.io/kelpie/)へ。
要件: opencode v2 / Tailscale / ビルドに Rust 1.98+ と pnpm 12。
