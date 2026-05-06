#!/usr/bin/env bash
set -euo pipefail

# Legacy self-update entrypoint. Older installed OGB versions fetch this path
# from main; keep it as a tiny bridge to the reorganized script location.
REPO="${OGB_GITHUB_REPO:-augustocaruso/opencode-gemini-bridge}"
URL="https://raw.githubusercontent.com/$REPO/main/scripts/bootstrap-mac.sh"
TMP_FILE="$(mktemp "${TMPDIR:-/tmp}/ogb-bootstrap-legacy.XXXXXX")"
cleanup() {
  rm -f "$TMP_FILE"
}
trap cleanup EXIT

curl -fsSL "$URL" -o "$TMP_FILE"
exec bash "$TMP_FILE" "$@"
