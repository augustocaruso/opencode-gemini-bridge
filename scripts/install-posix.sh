#!/usr/bin/env bash
set -euo pipefail

INSTALL_PLATFORM="darwin"

usage() {
  cat <<'EOF'
Usage: install-posix.sh [--platform darwin|linux] [--project PATH] [--prefix PATH] [--no-setup] [--no-ux] [--no-opencode] [--force] [--rulesync MODE]

Installs the ogb CLI, then delegates the install ritual to:
ogb install

Defaults:
  --project  current working directory
  --prefix   $OGB_PREFIX, else the npm global prefix when writable and on PATH,
             else $HOME/.local

Examples:
  scripts/install-mac.sh --project "$PWD"
  scripts/install-linux.sh --project "$PWD"
  scripts/install-linux.sh --project ~/Code/my-project --prefix ~/.local
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

bash_quote() {
  printf '%q' "$1"
}

require_node_22() {
  if ! command -v node >/dev/null 2>&1; then
    echo "Node.js >=22 is required before installing ogb." >&2
    exit 1
  fi

  local node_version
  local node_major
  node_version="$(node -p 'process.versions.node' 2>/dev/null || true)"
  node_major="${node_version%%.*}"
  if [[ ! "$node_major" =~ ^[0-9]+$ || "$node_major" -lt 22 ]]; then
    echo "Node.js >=22 is required before installing ogb. Found Node.js ${node_version:-unknown} at $(command -v node)." >&2
    exit 1
  fi
}

repair_directory_blocker() {
  local dir="$1"
  local operation="$2"
  if [[ ! -e "$dir" || -d "$dir" ]]; then
    return
  fi

  local stamp
  local backup_root
  local relative
  local backup_path
  local home_prefix
  stamp="$(date -u +"%Y-%m-%dT%H-%M-%SZ")-$$"
  backup_root="$HOME/.config/opencode-gemini-bridge/backups/$operation/$stamp/home"
  relative="$dir"
  home_prefix="$HOME/"
  case "$relative" in
    "$home_prefix"*) relative="${relative#"$home_prefix"}" ;;
  esac
  backup_path="$backup_root/$relative"
  mkdir -p "$(dirname "$backup_path")"
  mv "$dir" "$backup_path"
  mkdir -p "$dir"
  echo "Repaired file blocking OpenCode config directory: $dir (backup: $backup_path)"
}

emit_unique_targets() {
  local seen=$'\n'
  local target
  for target in "$@"; do
    if [[ -z "$target" ]]; then
      continue
    fi
    if [[ "$seen" == *$'\n'"$target"$'\n'* ]]; then
      continue
    fi
    printf '%s\n' "$target"
    seen+="$target"$'\n'
  done
}

linux_profile_targets() {
  local shell_name="${SHELL##*/}"
  case "$shell_name" in
    bash)
      emit_unique_targets "$HOME/.profile" "$HOME/.bashrc"
      ;;
    zsh)
      emit_unique_targets "$HOME/.profile" "$HOME/.zshrc"
      ;;
    fish)
      emit_unique_targets "$HOME/.profile" "$HOME/.config/fish/config.fish"
      ;;
    *)
      emit_unique_targets "$HOME/.profile"
      ;;
  esac
}

is_fish_config_target() {
  [[ "$1" == "$HOME/.config/fish/config.fish" ]]
}

path_profile_targets() {
  if [[ "$INSTALL_PLATFORM" == "linux" ]]; then
    linux_profile_targets
  else
    emit_unique_targets "$HOME/.zshrc"
  fi
}

exa_profile_targets() {
  if [[ "$INSTALL_PLATFORM" == "linux" ]]; then
    linux_profile_targets
  else
    emit_unique_targets "$HOME/.config/zsh/.zshrc"
  fi
}

ensure_path_on_profiles() {
  local path_line="export PATH=\"$PREFIX/bin:\$PATH\""
  local fish_path_block
  local target

  fish_path_block="$(cat <<EOF
if not contains "$PREFIX/bin" \$PATH
    set -gx PATH "$PREFIX/bin" \$PATH
end
EOF
)"

  if [[ ":$PATH:" == *":$PREFIX/bin:"* ]]; then
    return
  fi

  while IFS= read -r target; do
    mkdir -p "$(dirname "$target")"
    if [[ -f "$target" ]] && grep -Fq "$PREFIX/bin" "$target"; then
      echo "Note: $PREFIX/bin is already mentioned in $target, but not active in this shell."
    elif is_fish_config_target "$target"; then
      printf '\n# Added by OpenCode Gemini Bridge installer\n%s\n' "$fish_path_block" >> "$target"
      echo "Added $PREFIX/bin to $target."
    else
      printf '\n# Added by OpenCode Gemini Bridge installer\n%s\n' "$path_line" >> "$target"
      echo "Added $PREFIX/bin to $target."
    fi
  done < <(path_profile_targets)

  export PATH="$PREFIX/bin:$PATH"
}

ensure_opencode_exa_env() {
  local exa_line="export OPENCODE_ENABLE_EXA=1"
  local fish_exa_line="set -gx OPENCODE_ENABLE_EXA 1"
  local exa_pattern='^[[:space:]]*(export[[:space:]]+)?OPENCODE_ENABLE_EXA=1([[:space:]]*(#.*)?)?$'
  local fish_exa_pattern='^[[:space:]]*set[[:space:]]+-(gx|xg)[[:space:]]+OPENCODE_ENABLE_EXA[[:space:]]+1([[:space:]]*(#.*)?)?$'
  local line
  local pattern
  local target

  while IFS= read -r target; do
    if is_fish_config_target "$target"; then
      line="$fish_exa_line"
      pattern="$fish_exa_pattern"
    else
      line="$exa_line"
      pattern="$exa_pattern"
    fi

    mkdir -p "$(dirname "$target")"
    if [[ -f "$target" ]] && grep -Eq "$pattern" "$target"; then
      echo "OpenCode Exa websearch env already configured in $target."
    else
      printf '\n# Enable OpenCode native websearch backed by Exa.\n%s\n' "$line" >> "$target"
      echo "Added OPENCODE_ENABLE_EXA=1 to $target."
    fi
  done < <(exa_profile_targets)

  export OPENCODE_ENABLE_EXA=1
}

repair_ogb_shim() {
  local global_root
  local cli_target
  local version_output

  global_root="$(npm --prefix "$PREFIX" root -g 2>/dev/null || true)"
  cli_target="$global_root/opencode-gemini-bridge/dist/cli.js"
  if [[ ! -f "$cli_target" ]]; then
    echo "Installed ogb CLI target was not found at $cli_target." >&2
    return 1
  fi

  chmod +x "$cli_target" 2>/dev/null || true
  version_output="$("$OGB_BIN" --version 2>/dev/null || true)"
  if [[ -z "$version_output" ]]; then
    rm -f "$OGB_BIN"
    {
      printf '#!/usr/bin/env bash\n'
      printf 'exec node %s "$@"\n' "$(bash_quote "$cli_target")"
    } > "$OGB_BIN"
    chmod +x "$OGB_BIN"
  fi

  version_output="$("$OGB_BIN" --version 2>/dev/null || true)"
  if [[ -z "$version_output" ]]; then
    echo "Installed ogb verification returned no version output." >&2
    return 1
  fi
}

install_ogb_package() {
  local force_flag="${1:-0}"
  local pack_dir
  local package_tgz
  local install_status=0

  pack_dir="$(mktemp -d "${TMPDIR:-/tmp}/ogb-npm-pack.XXXXXX")"
  if ! (cd "$CLI_DIR" && npm pack --pack-destination "$pack_dir"); then
    rm -rf "$pack_dir"
    return 1
  fi

  package_tgz="$(find "$pack_dir" -maxdepth 1 -type f -name 'opencode-gemini-bridge-*.tgz' -print -quit)"
  if [[ -z "$package_tgz" || ! -f "$package_tgz" ]]; then
    echo "npm pack did not produce an opencode-gemini-bridge tarball." >&2
    rm -rf "$pack_dir"
    return 1
  fi

  if [[ "$force_flag" -eq 1 ]]; then
    npm install --prefix "$PREFIX" -g "$package_tgz" --force || install_status=$?
  else
    npm install --prefix "$PREFIX" -g "$package_tgz" || install_status=$?
  fi
  rm -rf "$pack_dir"
  return "$install_status"
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CLI_DIR="$REPO_ROOT/packages/ogb"
PROJECT_DIR="$(pwd)"
PREFIX=""
RUN_SETUP=1
RUN_UX=1
RUN_HOME_SYNC=0
INSTALL_OPENCODE=1
FORCE=0
RULESYNC_MODE="auto"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --platform)
      INSTALL_PLATFORM="$2"
      shift 2
      ;;
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

case "$INSTALL_PLATFORM" in
  darwin|linux)
    ;;
  *)
    echo "Unsupported POSIX platform: $INSTALL_PLATFORM" >&2
    usage >&2
    exit 2
    ;;
esac

require_node_22

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required before installing ogb." >&2
  exit 1
fi

if [[ -z "$PREFIX" ]]; then
  PREFIX="$(default_prefix)"
fi

PROJECT_DIR="$(cd "$PROJECT_DIR" && pwd)"
if [[ "$PROJECT_DIR" == "$HOME" && "$RUN_SETUP" -eq 1 ]]; then
  echo "Home directory detected; installing global OGB/OpenCode profile and skipping project setup files."
  RUN_HOME_SYNC=1
  RUN_SETUP=0
fi

repair_directory_blocker "$HOME/.config/opencode" "posix-installer"

mkdir -p "$HOME/.config/opencode"
mkdir -p "$HOME/.agents/skills"
mkdir -p "$HOME/.ai/opencode-pack"
mkdir -p "$PREFIX/bin"

echo "Building ogb CLI..."
npm --prefix "$CLI_DIR" install
npm --prefix "$CLI_DIR" run build

OGB_BIN="$PREFIX/bin/ogb"
echo "Installing ogb into $PREFIX..."
if ! install_ogb_package 0; then
  echo "npm install did not complete; removing stale ogb shim and retrying with --force..."
  rm -f "$OGB_BIN"
  install_ogb_package 1
fi

if ! repair_ogb_shim; then
  echo "ogb command shim was not created or did not run; retrying npm install with --force..."
  rm -f "$OGB_BIN"
  install_ogb_package 1
  repair_ogb_shim
fi

if [[ ! -x "$OGB_BIN" ]]; then
  echo "Expected ogb at $OGB_BIN, but it was not executable." >&2
  exit 1
fi

if ! "$OGB_BIN" --version >/dev/null; then
  echo "Installed ogb at $OGB_BIN, but it did not run." >&2
  exit 1
fi

ensure_path_on_profiles
ensure_opencode_exa_env

INSTALL_ARGS=(--project "$PROJECT_DIR" install --rulesync "$RULESYNC_MODE")
if [[ "$RUN_UX" -eq 0 ]]; then
  INSTALL_ARGS+=(--no-ux)
fi
if [[ "$INSTALL_OPENCODE" -eq 0 ]]; then
  INSTALL_ARGS+=(--no-install-opencode)
fi
if [[ "$FORCE" -eq 1 ]]; then
  INSTALL_ARGS+=(--force)
  if [[ "$RUN_HOME_SYNC" -eq 1 ]]; then
    INSTALL_ARGS+=(--reset-global)
  fi
fi
if [[ "$RUN_SETUP" -eq 0 && "$RUN_HOME_SYNC" -eq 0 ]]; then
  INSTALL_ARGS+=(--no-check)
fi

echo "Running OGB install ritual for $PROJECT_DIR..."
set +e
"$OGB_BIN" "${INSTALL_ARGS[@]}"
INSTALL_STATUS=$?
set -e
if [[ "$INSTALL_STATUS" -eq 1 ]]; then
  echo "OGB install completed with warnings; continuing bootstrap."
elif [[ "$INSTALL_STATUS" -ne 0 ]]; then
  exit "$INSTALL_STATUS"
fi

echo "Done."
if command -v ogb >/dev/null 2>&1; then
  echo "Try: ogb --project \"$PROJECT_DIR\" check"
else
  echo "Try: $OGB_BIN --project \"$PROJECT_DIR\" check"
fi
