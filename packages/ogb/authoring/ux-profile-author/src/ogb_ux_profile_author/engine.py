from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any, Iterable, Optional


def package_root(start: Optional[Path] = None) -> Path:
    current = (start or Path(__file__)).resolve()
    for parent in [current, *current.parents]:
        package_json = parent / "package.json"
        if package_json.exists():
            try:
                if json.loads(package_json.read_text(encoding="utf-8")).get("name") == "opencode-gemini-bridge":
                    return parent
            except Exception:
                pass
    return Path(__file__).resolve().parents[4]


def engine_script(root: Optional[Path] = None) -> Path:
    return (root or package_root()) / "authoring" / "ux-profile-engine.ts"


def tsx_command(root: Optional[Path] = None) -> list[str]:
    pkg = root or package_root()
    node = shutil.which("node")
    if not node:
        raise RuntimeError("node was not found on PATH")

    tsx_cli = pkg / "node_modules" / "tsx" / "dist" / "cli.mjs"
    if tsx_cli.exists():
        return [node, str(tsx_cli)]

    tsx_bin = pkg / "node_modules" / ".bin" / ("tsx.cmd" if os.name == "nt" else "tsx")
    if tsx_bin.exists():
        return [str(tsx_bin)]

    tsx_path = shutil.which("tsx")
    if tsx_path:
        return [tsx_path]

    raise RuntimeError("tsx was not found. Run npm install in packages/ogb first.")


def engine_command(args: Iterable[str], root: Optional[Path] = None) -> list[str]:
    pkg = root or package_root()
    return [*tsx_command(pkg), str(engine_script(pkg)), *list(args)]


def run_engine(args: Iterable[str], root: Optional[Path] = None) -> subprocess.CompletedProcess[str]:
    pkg = root or package_root()
    command = engine_command(args, pkg)
    return subprocess.run(command, cwd=str(pkg), text=True, capture_output=True, check=False)


def run_engine_json(args: Iterable[str], root: Optional[Path] = None) -> dict[str, Any]:
    result = run_engine(args, root)
    if result.returncode not in (0, 2):
        detail = result.stderr.strip() or result.stdout.strip() or f"engine exited with {result.returncode}"
        raise RuntimeError(detail)
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"engine returned invalid JSON: {exc}") from exc


def selected_arg(selected: Iterable[str]) -> list[str]:
    values = [item for item in selected if item]
    return ["--select", ",".join(values)] if values else []
