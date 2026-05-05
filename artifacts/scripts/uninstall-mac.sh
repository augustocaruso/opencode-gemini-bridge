#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: uninstall-mac.sh [--project PATH] [--prefix PATH] [--remove-project-files]

Removes the global ogb CLI installed by install-mac.sh.

By default, project files are kept. Pass --remove-project-files to remove only
OGB-managed project plugins/generated dashboard files; user Gemini extensions
and OpenCode config are not deleted.
EOF
}

PROJECT_DIR="$(pwd)"
PREFIX="${OGB_PREFIX:-$(npm prefix -g 2>/dev/null || printf '%s/.local' "$HOME")}"
REMOVE_PROJECT_FILES=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project)
      PROJECT_DIR="$2"
      shift 2
      ;;
    --prefix)
      PREFIX="$2"
      shift 2
      ;;
    --remove-project-files)
      REMOVE_PROJECT_FILES=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

echo "Removing global ogb package from $PREFIX..."
npm uninstall --prefix "$PREFIX" -g opencode-gemini-bridge >/dev/null 2>&1 || true
rm -f "$PREFIX/bin/ogb"

if [[ "$REMOVE_PROJECT_FILES" -eq 1 ]]; then
  echo "Removing OGB-managed project runtime files from $PROJECT_DIR..."
  rm -f "$PROJECT_DIR/.opencode/plugins/ogb-startup-sync.js"
  rm -f "$PROJECT_DIR/.opencode/tui-plugins/ogb-sidebar.js"
  rm -f "$PROJECT_DIR/.opencode/generated/ogb-dashboard.json"
  rm -f "$PROJECT_DIR/.opencode/generated/ogb-dashboard.md"
  rm -f "$PROJECT_DIR/.opencode/generated/ogb-plugin-status.json"
  rm -f "$PROJECT_DIR/.opencode/generated/ogb-startup-sync.json"
fi

echo "Done."
