#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: install-mac.sh [--project PATH] [--prefix PATH] [--no-setup] [--no-ux] [--no-opencode] [--force] [--rulesync MODE]

Installs the ogb CLI, applies the global OpenCode UX profile, and optionally
runs the full project setup:
ogb setup-ux -> ogb import -> ogb setup-opencode -> ogb doctor -> ogb validate -> ogb security-check -> ogb dashboard.

Defaults:
  --project  current working directory
  --prefix   $OGB_PREFIX, else the npm global prefix when writable and on PATH,
             else $HOME/.local

Examples:
  artifacts/scripts/install-mac.sh --project "$PWD"
  artifacts/scripts/install-mac.sh --project ~/Code/my-project --prefix ~/.local
  artifacts/scripts/install-mac.sh --project "$PWD" --no-opencode
EOF
}

path_contains() {
  case ":$PATH:" in
    *":$1:"*) return 0 ;;
    *) return 1 ;;
  esac
}

default_prefix() {
  if [[ -n "${OGB_PREFIX:-}" ]]; then
    printf '%s\n' "$OGB_PREFIX"
    return
  fi

  local npm_prefix
  npm_prefix="$(npm prefix -g 2>/dev/null || true)"
  if [[ -n "$npm_prefix" && -d "$npm_prefix" && -w "$npm_prefix" && -d "$npm_prefix/bin" ]] && path_contains "$npm_prefix/bin"; then
    printf '%s\n' "$npm_prefix"
    return
  fi

  printf '%s\n' "$HOME/.local"
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ARTIFACTS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CLI_DIR="$ARTIFACTS_DIR/bridge-cli-skeleton"
PROJECT_DIR="$(pwd)"
PREFIX="$(default_prefix)"
RUN_SETUP=1
RUN_UX=1
INSTALL_OPENCODE=1
FORCE=0
RULESYNC_MODE="auto"

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
    --no-setup)
      RUN_SETUP=0
      shift
      ;;
    --no-ux)
      RUN_UX=0
      shift
      ;;
    --no-opencode)
      INSTALL_OPENCODE=0
      shift
      ;;
    --rulesync)
      RULESYNC_MODE="$2"
      shift 2
      ;;
    --force)
      FORCE=1
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

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required before installing ogb." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required before installing ogb." >&2
  exit 1
fi

mkdir -p "$HOME/.config/opencode"
mkdir -p "$HOME/.agents/skills"
mkdir -p "$HOME/.ai/opencode-pack"
mkdir -p "$PREFIX/bin"

echo "Building ogb CLI..."
npm --prefix "$CLI_DIR" install
npm --prefix "$CLI_DIR" run build

echo "Installing ogb into $PREFIX..."
npm install --prefix "$PREFIX" -g "$CLI_DIR"

OGB_BIN="$PREFIX/bin/ogb"
if [[ ! -x "$OGB_BIN" ]]; then
  echo "ogb command shim was not created; retrying npm install with --force..."
  npm install --prefix "$PREFIX" -g "$CLI_DIR" --force
fi

if [[ ! -x "$OGB_BIN" ]]; then
  GLOBAL_ROOT="$(npm --prefix "$PREFIX" root -g 2>/dev/null || true)"
  CLI_TARGET="$GLOBAL_ROOT/opencode-gemini-bridge/dist/cli.js"
  if [[ -x "$CLI_TARGET" ]]; then
    ln -sf "$CLI_TARGET" "$OGB_BIN"
  fi
fi

if [[ ! -x "$OGB_BIN" ]]; then
  echo "Expected ogb at $OGB_BIN, but it was not executable." >&2
  exit 1
fi

"$OGB_BIN" --version >/dev/null

if [[ ":$PATH:" != *":$PREFIX/bin:"* ]]; then
  ZSHRC="$HOME/.zshrc"
  PATH_LINE="export PATH=\"$PREFIX/bin:\$PATH\""
  if [[ -f "$ZSHRC" ]] && grep -Fq "$PREFIX/bin" "$ZSHRC"; then
    echo "Note: $PREFIX/bin is already mentioned in $ZSHRC, but not active in this shell."
  else
    printf '\n# Added by OpenCode Gemini Bridge installer\n%s\n' "$PATH_LINE" >> "$ZSHRC"
    echo "Added $PREFIX/bin to $ZSHRC."
  fi
  export PATH="$PREFIX/bin:$PATH"
fi

if [[ "$RUN_UX" -eq 1 ]]; then
  UX_ARGS=(--project "$PROJECT_DIR" setup-ux)
  if [[ "$INSTALL_OPENCODE" -eq 0 ]]; then
    UX_ARGS+=(--no-install-opencode)
  fi
  if [[ "$FORCE" -eq 1 ]]; then
    UX_ARGS+=(--force)
  fi
  echo "Installing OpenCode and the OGB UX profile..."
  "$OGB_BIN" "${UX_ARGS[@]}"
fi

if [[ "$RUN_SETUP" -eq 1 ]]; then
  IMPORT_ARGS=(--project "$PROJECT_DIR" import --rulesync "$RULESYNC_MODE")
  SETUP_ARGS=(--project "$PROJECT_DIR" setup-opencode --skip-doctor)
  if [[ "$FORCE" -eq 1 ]]; then
    IMPORT_ARGS+=(--force)
    SETUP_ARGS+=(--force)
  fi
  echo "Running ogb import for $PROJECT_DIR..."
  "$OGB_BIN" "${IMPORT_ARGS[@]}"
  echo "Installing OpenCode startup plugin for $PROJECT_DIR..."
  "$OGB_BIN" "${SETUP_ARGS[@]}"
  echo "Running final doctor for $PROJECT_DIR..."
  "$OGB_BIN" --project "$PROJECT_DIR" doctor
  echo "Running final validation for $PROJECT_DIR..."
  "$OGB_BIN" --project "$PROJECT_DIR" validate
  echo "Running final security check for $PROJECT_DIR..."
  "$OGB_BIN" --project "$PROJECT_DIR" security-check
  echo "Writing final dashboard for $PROJECT_DIR..."
  "$OGB_BIN" --project "$PROJECT_DIR" dashboard
fi

echo "Done."
if command -v ogb >/dev/null 2>&1; then
  echo "Try: ogb --project \"$PROJECT_DIR\" doctor"
else
  echo "Try: $OGB_BIN --project \"$PROJECT_DIR\" doctor"
fi
