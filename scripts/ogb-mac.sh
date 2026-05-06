#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CLI_DIR="$REPO_ROOT/packages/ogb"
PROJECT_DIR="${1:-$(pwd)}"

if command -v ogb >/dev/null 2>&1; then
  exec ogb --project "$PROJECT_DIR" launch
fi

if [[ ! -f "$CLI_DIR/dist/cli.js" ]]; then
  npm --prefix "$CLI_DIR" install
  npm --prefix "$CLI_DIR" run build
fi

exec node "$CLI_DIR/dist/cli.js" --project "$PROJECT_DIR" launch
