---
title: 設計
description: opencode v2 を一クライアントとして使うときの設計と、その理由。
---

> opencode v2 のサーバを、Tailscale 越しにスマホのチャットアプリとして操作する。
> Australian Kelpie（犬）より命名。

## 0. 決定事項

| 論点 | 決定 |
| --- | --- |
| 対象 | **opencode v2 専用**。herdr も他ハーネスも使わない |
| 実装 | **Rust（bridge / CLI）+ TypeScript（`crates/kelpie/web`）** |
| 統合面 | opencode v2 の **HTTP API + SSE**（画面スクレイプ・ログ解析・キー送信なし） |
| UI | ChatGPT 風モバイル GUI（assistant-ui）。ダーク固定 |
| 一覧 | **全プロジェクト横断**（`GET /api/session`）。未読は opencode の `time.idle` / `time.viewed` で判定 |
| ダイアログ | permission / form を API で構造的に回答 |
| 通知 | Web Push（VAPID）。`permission.asked` / `form.created` / `session.execution.*` |
| 公開 | OSS（MIT） |

## 1. なぜ opencode だけなのか

opencode v2 は **サーバ + クライアント**の構造で、TUI も web も IDE プラグインも
同じサーバのクライアントにすぎない。つまり外部クライアントに必要なものが全部ある:

| 必要なこと | opencode v2 の API |
| --- | --- |
| セッション一覧（全プロジェクト） | `GET /api/session` |
| 会話（構造化） | `GET /api/session/{id}/message` |
| ストリーミング | `GET /api/event`（`session.text.delta` 等） |
| 送信 | `POST /api/session/{id}/prompt` |
| 実行中の追加送信 | `POST .../prompt`（`delivery: queue`）/ `GET /api/session/{id}/inbox` / `DELETE .../inbox/{id}` |
| リポジトリ（worktree 統合）/ 本体チェックアウト | `GET /api/project` / `GET /api/worktree` |
| 権限 | `GET /api/session/{id}/permission` / `POST .../reply` |
| 質問（form） | `GET /api/session/{id}/form` / `POST .../reply` |
| 既読 | `POST /api/session/{id}/view`（表示した `time.idle` を記録） |
| 確認待ち | `GET /api/permission/request` / `GET /api/form`（location 単位、`sessionID` で突き合わせ） |

TUI 専用のハーネス（claude / codex / pi）は、画面を読んでキーを送るしかなく、
ストリーミングも構造化ダイアログも得られない。opencode はそれが要らないので、
**同じ目的なら圧倒的に綺麗に作れる**。herdr（マルチプレクサ）も、opencode が
サーバとして検知・所有・API を提供するため不要になった。

## 2. 全体アーキテクチャ

```
   スマホ / タブレット (PWA)
        │  HTTPS (tailnet 限定)          https://kelpie.<tailnet>.ts.net
        ▼
   tailscale serve            TLS 終端（loopback へ proxy）
        │  127.0.0.1:7180      kelpie は loopback のみ bind
        ▼
   kelpie (Rust, 単一バイナリ)
     ├─ 静的 PWA (crates/kelpie/web/dist) + JSON API
     ├─ opencode client : Basic 認証で /api/* を叩く
     ├─ event bridge    : GET /api/event (SSE) を常時購読 → ブラウザへ中継
     ├─ push            : VAPID + 購読ストア + Web Push
     └─ 状態            : ~/.local/state/kelpie/push.json
        │  HTTP (127.0.0.1:49374 等)
        ▼
   opencode v2 バックグラウンドサービス
     └─ 全プロジェクトのセッションを所有。TUI/web/kelpie はそのクライアント
```

- **kelpie は opencode の一クライアント**。プロセスも PTY も所有しない。
- ターミナルの TUI と**同じセッションを同時に見られる**（どちらもサーバのクライアント）。
- 通知はプロンプトの出どころ（スマホ / ターミナル / CLI）に依存しない。

## 3. opencode との接続

- **URL**: `opencode service status` が `http://127.0.0.1:<port>` を返す（ポートは再起動で変わるので30秒で再探索）
- **認証**: `~/.config/opencode/service.json` の `password` で Basic 認証（ユーザ名は `opencode`）
- **イベント**: `GET /api/event` は SSE。`data: {...}\n\n` を読み、`type` で振り分ける

主なイベント:

| イベント | 用途 |
| --- | --- |
| `session.text.started` / `.delta` / `.ended` | 本文のストリーミング |
| `session.reasoning.*` | 思考のストリーミング |
| `session.tool.*` | ツール呼び出し |
| `session.execution.succeeded` / `.failed` | ターン完了（通知） |
| `session.inbox.*` | 送信が受付・配信・取消された（キューの再取得） |
| `permission.asked` | 権限待ち（通知 + dock） |
| `form.created` | 質問（通知 + dock） |

## 4. UI

- **Home**: 全セッションを**リポジトリ別**、その下に**ディレクトリ（worktree）別**に一覧。
  同じリポジトリの worktree は opencode の `projectID` でひとつにまとまり、
  本体チェックアウト（`GET /api/worktree` で `strategy` が付かないディレクトリ）の
  basename をリポジトリ名にする。状態ドット、相対時刻。
- **既読 / 未読 / 確認待ち**: 左のドットで状態を示す。未読（`time.idle` > `time.viewed`）は
  緑、既読はドットなし。許可・質問で止まっているセッションはオレンジ、実行中は水色（点滅）。
  チャットを開くと `POST /api/session/{id}/view` に表示中の `idle` を送り、表示中にターンが
  完了したらその都度送り直す。`viewed` は opencode が共有するので、TUI で読めば kelpie 側の
  未読も消える。
- **確認待ちの検出**: 権限とフォームは opencode では location（セッションの作業ディレクトリ）
  単位なので、一覧を返すときにページ内の各ディレクトリについて
  `GET /api/permission/request` / `GET /api/form` を一度ずつ引き、`sessionID` で突き合わせる。
- **Chat**: assistant-ui の styled `Thread`。会話は opencode のメッセージをそのまま描画
  （`user` → バブル、`assistant` の `text` → markdown、`reasoning` → 折りたたみ、`tool` → カード）。
- **ストリーミング**: `session.text.delta` を積んで進行中の発言を描画。`step.ended` で
  権威ある一覧を再取得。
- **実行中の追加送信**: 送信は `delivery: queue` で opencode に渡し、セッションの
  **inbox** に入る。スマホはその inbox を composer の上に「送信待ち」として描画する
  （取り消しは `DELETE .../inbox/{id}`）。ブラウザ側にキューを持たないので、スマホと
  TUI が同じキューを見え、実行中のターンを中断しない。`session.inbox.*` で再取得。
- **HarnessDock**: composer の上に固定。
  - permission → 「許可 / 常に許可 / 拒否」
  - form → フィールド（string / number / boolean / multiselect）を描画
- **スキル**: composer のピッカーから、そのセッションの directory に効くスキル
  （`GET /api/skill`、`location[directory]` で絞る）を選び、次の送信に
  `skills: [{ id }]` として添付する。選んだスキルは composer 上のチップに出す。
  読み込みは `skill` メッセージとしてツールカードで見える（`convert.ts`）。

## 5. 通知

- **VAPID** 鍵は初回起動時に生成（`p256`、`~/.local/state/kelpie/push.json`）
- 端末の購読を保存し、`web-push` で送信（`urgency: high`、TTL 6h、404/410 は破棄）
- トリガ: `permission.asked` / `form.created` / `session.execution.succeeded` / `.failed`
- タイトルは**リポジトリ名**で始める（worktree のブランチではなく本体チェックアウトの
  basename。セッションの `projectID` から `GET /api/worktree` で解決し、セッション単位・
  プロジェクト単位でキャッシュ）
- 本文に**何を聞かれているか**を載せる（権限は action + resources、form は質問）
- タップで対象セッションを開く。iOS は URL クエリを落とすことがあるので、
  SW が Cache Storage にセッションIDを置き、起動時にアプリが読む

## 6. セットアップ / 運用

```bash
cargo build --release
pnpm --dir crates/kelpie/web install
pnpm --dir crates/kelpie/web build
./target/release/kelpie serve --port 7180 --static-dir "$PWD/crates/kelpie/web/dist"
```

- opencode のサービスが動いていること（`opencode service start` / TUI 起動）
- `tailscale serve` で loopback を tailnet に公開（kelpie 自身は設定しない）
- 通知はスマホで「通知を有効にする」をタップ（iOS はホーム画面追加が必須）

## 7. セキュリティ

- kelpie は **`127.0.0.1` のみ bind**。front door は `tailscale serve`
- opencode の Basic 認証情報は kelpie が読むだけで、ブラウザには渡さない
- PWA の pane 出力は React のテキストノードとして描画（`innerHTML` 禁止）
- `tailscale funnel` は禁止
