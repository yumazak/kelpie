# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.29](https://github.com/yumazak/kelpie/compare/v0.1.28...v0.1.29) - 2026-09-27

### Fixed

- *(web)* fade only when opening a session, not on the way back

## [0.1.28](https://github.com/yumazak/kelpie/compare/v0.1.27...v0.1.28) - 2026-09-26

### Added

- 設定ページを追加し、通知をヘッダーから移す

### Changed

- 画面遷移にフェード・先読み・pending 表示を入れる

### Fixed

- *(web)* resync on foreground so a notification tap shows the latest

## [0.1.27](https://github.com/yumazak/kelpie/compare/v0.1.26...v0.1.27) - 2026-09-26

### Fixed

- *(web)* keep the reasoning disclosure closed while streaming
- *(web)* keep the reader's place when older messages load

## [0.1.26](https://github.com/yumazak/kelpie/compare/v0.1.25...v0.1.26) - 2026-09-26

### Added

- *(web)* page message history and drop the polling fallback

### Fixed

- *(web)* avoid a message gap when a burst outruns the newest slice
- *(web)* keep the 考え中 indicator visible while a turn runs

### Other

- *(web)* fetch only the newest slice when a session refreshes
- *(kelpie)* stop shipping message snapshots; set cache headers

## [0.1.25](https://github.com/yumazak/kelpie/compare/v0.1.24...v0.1.25) - 2026-09-26

### Fixed

- *(web)* keep the thread at the real bottom and stop dropping message updates

## [0.1.24](https://github.com/yumazak/kelpie/compare/v0.1.23...v0.1.24) - 2026-09-26

### Added

- kelpie のアイコンと PWA アイコン一式を追加

## [0.1.23](https://github.com/yumazak/kelpie/compare/v0.1.22...v0.1.23) - 2026-09-26

### Added

- セッション一覧に未読と確認待ちを表示する

### Other

- Merge pull request #13 from yumazak/feature/mark-read

## [0.1.22](https://github.com/yumazak/kelpie/compare/v0.1.21...v0.1.22) - 2026-09-26

### Added

- セッション一覧と通知をリポジトリ単位にまとめる

### Added

- セッション一覧をリポジトリ別にまとめ、その下に worktree ごとのディレクトリを表示する
  （同じリポジトリの worktree は opencode の `projectID` で統合。`GET /api/projects` を追加）
- 通知のタイトルをディレクトリ（worktree のブランチ）ではなくリポジトリ名にする
  （本体チェックアウトの basename。`GET /api/worktree` から解決）

## [0.1.21](https://github.com/yumazak/kelpie/compare/v0.1.20...v0.1.21) - 2026-09-26

### Added

- スキルを composer から選んで添付できるようにする

### Other

- release-plz でリリースフローを整備し、1クレートに統合
- Merge pull request #2 from yumazak/feature/skills
