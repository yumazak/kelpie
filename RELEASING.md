# リリース

リリースは [release-plz](https://release-plz.dev) で行います。バージョンは git タグから決まり、crates.io には公開しません（`release-plz.toml` の `git_only = true`）。

## 流れ

1. ふつうに `main` へ push する（変更 PR をマージする）。
2. `.github/workflows/release.yml` の `release-plz-pr` が、変更をまとめた**リリースPR**（`chore: release vX.Y.Z`）を作成または更新します。
   - 中身は `Cargo.toml` の `[workspace.package] version` と `CHANGELOG.md` だけ。
   - **この時点ではまだ何もリリースされません。**
3. その PR の中身（バージョン・CHANGELOG）を確認し、必要なら編集して**マージ**します。
4. マージすると `release-plz-release` が `vX.Y.Z` タグと GitHub Release を作成し、続けて `build-macos` が `kelpie-aarch64-apple-darwin` と `.sha256` を添付します。
5. 利用者は `mise use -g github:yumazak/kelpie` でその Release に追従します。

リリースPRを貯めておいて、マージしたときだけ出すバッチ運用です。

## まとめてから出すには

`main` へ機能をマージしても、それだけではリリースされません（`release_always = false`）。**リリースPRをマージしたときだけ**タグが付きます。つまり:

- 機能PRは `main` にどんどんマージしてよい。
- リリースPRは**出したいと思ったときだけ**マージする。それまで放置してよい。
- 新しいコミットが `main` に入るたび、同じリリースPRが更新され、CHANGELOG が貯まっていく。

やり方の例:

- **気が済むまで貯める**: 出し切ってからリリースPRをマージする。
- **定期リリース（リリーストレイン）**: 毎週金曜などに、その時点のリリースPRをマージする。
- **版数を狙う**: `feat!:` や `BREAKING CHANGE:` で 0.x は minor（0.1 → 0.2）。それ以外は patch。
- **緊急修正だけ先に出す**: リリースPRを今すぐマージする（積んである分も一緒に出る）。積み分を出したくない機能は、リリースPRをマージするまで `main` に入れないか、feature flag で隠す。

版数は新しいコミットのたびに再計算されます。手で編集するのは「もう `main` に積まない」と決めたマージ直前にするのが安全です。

## 初回セットアップ（リポジトリ設定）

一度だけ必要です。

- **Settings → Actions → General → Workflow permissions** で **"Allow GitHub Actions to create and approve pull requests"** を有効にする。release-plz がリリースPRを作るために必要です。
- `main` を保護する場合、release-plz のブランチ（`release-plz-*`）からの PR を許可する。CI を必須にするなら、リリースPRを一度 close → reopen すると CI が走ります（下記「注意」参照）。

## バージョンの決まり方

[Conventional Commits](https://www.conventionalcommits.org/) から release-plz が決めます。

| コミット | 0.x の次の版 | 1.x 以降 |
| --- | --- | --- |
| `feat:` | patch | minor |
| `fix:` / `perf:` / `refactor:` / その他 | patch | patch |
| `feat!:` / `BREAKING CHANGE:` | minor | major |

`web/`（`crates/kelpie/web/`）の変更も同じクレートの変更として数えられます。1バイナリに web が埋め込まれるので、リリース単位はリポジトリ全体です。

## 注意

- リリースは**リリースPRをマージしたときだけ**。`main` へ直接バージョンを上げてもタグは作りません（`release_always = false`）。
- release-plz は `GITHUB_TOKEN` でタグと Release を作るため、**他の workflow を起動しません**。だから macOS ビルドは同じ `release.yml` 内で実行しています。タグ push を別 workflow のトリガにしたい場合は、release-plz に PAT / GitHub App のトークンを渡してください。
- 同じ理由で、**リリースPRには CI が自動では走りません**。確認したいときは PR を close → reopen します。
- タグと成果物の名前は mise が依存しています。**変えないでください**:
  - タグ: `vX.Y.Z`
  - 成果物: `kelpie-aarch64-apple-darwin`（+ `.sha256`）
