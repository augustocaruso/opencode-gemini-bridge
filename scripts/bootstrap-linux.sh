#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: bootstrap-linux.sh [--repo OWNER/REPO] [--version vX.Y.Z|latest] [installer args...]

Downloads the OpenCode Gemini Bridge release pack from GitHub and runs the
bundled Linux installer.

Examples:
  curl -fsSL https://raw.githubusercontent.com/augustocaruso/opencode-gemini-bridge/main/scripts/bootstrap-linux.sh | bash -s -- --project "$PWD"
  OGB_GITHUB_REPO=augustocaruso/opencode-gemini-bridge bash bootstrap-linux.sh --project "$PWD" --force
EOF
}

REPO="${OGB_GITHUB_REPO:-augustocaruso/opencode-gemini-bridge}"
VERSION="${OGB_RELEASE_VERSION:-latest}"
INSTALLER_ARGS=()
INSTALLER_ARGS_PREFIX=()

run_installer() {
  local args=()
  if [[ "${#INSTALLER_ARGS_PREFIX[@]}" -gt 0 ]]; then
    args+=("${INSTALLER_ARGS_PREFIX[@]}")
  fi
  if [[ "${#INSTALLER_ARGS[@]}" -gt 0 ]]; then
    args+=("${INSTALLER_ARGS[@]}")
  fi
  if [[ "${#args[@]}" -gt 0 ]]; then
    exec bash "$INSTALLER" "${args[@]}"
  fi
  exec bash "$INSTALLER"
}

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
INSTALLER="$(find "$TMP_DIR/unpacked" -path '*/scripts/install-linux.sh' -type f | head -n 1)"

if [[ -z "$INSTALLER" ]]; then
  INSTALLER="$(find "$TMP_DIR/unpacked" -path '*/scripts/install-posix.sh' -type f | head -n 1)"
  if [[ -n "$INSTALLER" ]]; then
    INSTALLER_ARGS_PREFIX=(--platform linux)
  fi
fi

if [[ -z "$INSTALLER" ]]; then
  INSTALLER="$(find "$TMP_DIR/unpacked" -path '*/scripts/install-mac.sh' -type f | head -n 1)"
  if [[ -n "$INSTALLER" ]]; then
    echo "Release pack predates the Linux installer; using the legacy POSIX installer fallback."
  fi
fi

if [[ -z "$INSTALLER" ]]; then
  echo "Release pack did not contain scripts/install-linux.sh, scripts/install-posix.sh, or scripts/install-mac.sh." >&2
  exit 1
fi

chmod +x "$INSTALLER"
run_installer
