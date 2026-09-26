#!/usr/bin/env bash
# Fail if web/src/routeTree.gen.ts is not what `tsr generate` would produce.
# Run from the repository root (prek local hooks do).
set -euo pipefail

pnpm --dir web gen:routes
git diff --exit-code -- web/src/routeTree.gen.ts
