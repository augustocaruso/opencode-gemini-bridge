#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: bootstrap-mac.sh [--repo OWNER/REPO] [--version vX.Y.Z|latest] [installer args...]

Downloads the OpenCode Gemini Bridge release pack from GitHub and runs the
bundled macOS installer.

Examples:
  curl -fsSL https://raw.githubusercontent.com/OWNER/REPO/main/artifacts/scripts/bootstrap-mac.sh | bash -s -- --project "$PWD"
  OGB_GITHUB_REPO=OWNER/REPO bash bootstrap-mac.sh --project "$PWD" --force
EOF
}

REPO="${OGB_GITHUB_REPO:-augustocaruso/opencode-gemini-bridge}"
VERSION="${OGB_RELEASE_VERSION:-latest}"
INSTALLER_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)
      REPO="$2"
      shift 2
      ;;
    --version)
      VERSION="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      INSTALLER_ARGS+=("$1")
      shift
      ;;
  esac
done

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required to download the OGB release pack." >&2
  exit 1
fi

if ! command -v unzip >/dev/null 2>&1; then
  echo "unzip is required to unpack the OGB release pack." >&2
  exit 1
fi

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ogb-bootstrap.XXXXXX")"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

if [[ "$VERSION" == "latest" ]]; then
  RELEASE_URL="https://github.com/$REPO/releases/latest/download/opencode-gemini-bridge-pack.zip"
else
  RELEASE_URL="https://github.com/$REPO/releases/download/$VERSION/opencode-gemini-bridge-pack.zip"
fi

echo "Downloading OGB from $RELEASE_URL..."
curl -fL "$RELEASE_URL" -o "$TMP_DIR/ogb.zip"

unzip -q "$TMP_DIR/ogb.zip" -d "$TMP_DIR/unpacked"
INSTALLER="$(find "$TMP_DIR/unpacked" -path '*/artifacts/scripts/install-mac.sh' -type f | head -n 1)"

if [[ -z "$INSTALLER" ]]; then
  echo "Release pack did not contain artifacts/scripts/install-mac.sh." >&2
  exit 1
fi

chmod +x "$INSTALLER"
exec bash "$INSTALLER" "${INSTALLER_ARGS[@]}"
