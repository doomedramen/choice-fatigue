#!/usr/bin/env bash
set -euo pipefail

run_pnpm() {
  volta run --node 22 --pnpm 12.16.1 pnpm "$@"
}

run_pnpm test
run_pnpm typecheck
run_pnpm exec prisma validate
run_pnpm build
run_pnpm db:deploy:e2e
run_pnpm test:e2e
