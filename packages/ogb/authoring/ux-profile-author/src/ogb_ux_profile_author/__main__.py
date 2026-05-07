from __future__ import annotations

import sys

from .app import UxProfileAuthorApp
from .engine import run_engine


ENGINE_COMMANDS = {"inventory", "diff", "apply", "write-preset"}


def engine_args(argv: list[str]) -> list[str] | None:
    if not argv:
        return None
    if argv[0] in ENGINE_COMMANDS:
        return argv
    if "--json" in argv:
        return ["inventory", *argv]
    if "--dry-run" in argv or "--select" in argv or "--write" in argv:
        return ["write-preset", *argv]
    return None


def main(argv: list[str] | None = None) -> int:
    raw_args = list(sys.argv[1:] if argv is None else argv)
    passthrough = engine_args(raw_args)
    if passthrough is not None:
        result = run_engine(passthrough)
        if result.stdout:
            sys.stdout.write(result.stdout)
        if result.stderr:
            sys.stderr.write(result.stderr)
        return result.returncode

    return UxProfileAuthorApp().run()


if __name__ == "__main__":
    raise SystemExit(main())
