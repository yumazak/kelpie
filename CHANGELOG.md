# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
