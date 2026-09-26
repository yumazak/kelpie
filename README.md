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
pnpm --dir crates/kelpie/web install
pnpm --dir crates/kelpie/web build
./target/release/kelpie serve --port 7180 --static-dir "$PWD/crates/kelpie/web/dist"
```

- opencode v2 のサービスが動いていること（`opencode` か `opencode service start`）
- `tailscale serve` で `127.0.0.1:7180` を tailnet に公開
- スマホで開き、「通知を有効にする」をタップ（iOS はホーム画面追加が必須）

開発中は web の dev server を使う（`/api` は 7180 にプロキシ）:

```bash
cargo run -p kelpie -- serve --port 7180
pnpm --dir crates/kelpie/web dev
```

## インストール（macOS / Apple Silicon）

[GitHub Releases](https://github.com/yumazak/kelpie/releases) にビルド済みバイナリを置いています。mise で入れると更新も追従します。

```bash
mise use -g github:yumazak/kelpie
kelpie service install --port 7180
```

## リリース

`main` に push すると [release-plz](https://release-plz.dev) が **リリースPR**（バージョン + `CHANGELOG.md`）を作成・更新します。その PR をマージしたときだけタグと GitHub Release が作られ、macOS バイナリが添付されます。

詳しくは [`RELEASING.md`](./RELEASING.md) を参照。

コマンド・常駐化・設計は[ドキュメント](https://yumazak.github.io/kelpie/)へ。
要件: opencode v2 / Tailscale / ビルドに Rust 1.98+ と pnpm 12。
