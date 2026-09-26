# Contributing

Thanks for your interest in kelpie! Issues and pull requests are welcome.

## Requirements

The toolchain is pinned with [mise](https://mise.jdx.dev/):

```bash
mise install
```

- Rust 1.98+ and pnpm 12 (Node 26)

## Build and run

```bash
cargo build --release
pnpm --dir crates/kelpie/web install
pnpm --dir crates/kelpie/web build
./target/release/kelpie serve --port 7180 --static-dir "$PWD/crates/kelpie/web/dist"
```

For development, run the API and the Vite dev server side by side:

```bash
cargo run -p kelpie -- serve --port 7180
pnpm --dir crates/kelpie/web dev
```

## Checks

`prek` runs the checks before each commit. Run them all at once:

```bash
mise run check   # prek run --all-files
```

- Rust: `cargo fmt`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test`
- Web (`crates/kelpie/web`): `pnpm typecheck`, `pnpm lint`, `pnpm knip`, `pnpm build`
- Docs (`docs`): `pnpm build`

CI (`.github/workflows/ci.yml`) runs the same as the `rust`, `web`, and `docs` jobs.

## Commits

Follow [Conventional Commits](https://www.conventionalcommits.org/). The changelog and the
version are derived from them by [release-plz](https://release-plz.dev):

```
feat: queue messages while a turn is running
fix: drop the empty BranchPicker (2 / 2)
docs: add setup notes
```

- `feat!:` or a `BREAKING CHANGE:` footer marks a breaking change (a minor bump while on `0.x`)
- One PR, one purpose; keep unrelated cleanups in their own PR

## Pull requests

- Open the PR against `main` (it is protected)
- Make sure CI passes (`rust`, `web`, `docs`)
- Don't edit the version in `Cargo.toml` or `CHANGELOG.md` by hand — release-plz owns them
