# ADR-007 — agent-rules-sync after bootstrap

## Status

Proposed.

## Context

The original bridge design was Gemini-first because the existing Gemini setup is the user's current working base. During exploration, `agent-rules-sync` became attractive because the desired future is not necessarily Gemini-first forever.

The likely future is tool-neutral:

```text
edit anywhere -> sync everywhere
```

## Decision

Keep Gemini-first for bootstrap/import.

Explore `agent-rules-sync` as the basis for a later bidirectional sync layer, with `ogb` remaining responsible for safety:

- dry-run before adoption
- backups
- conflict detection
- source map / hash state
- doctor output
- no daemon install without explicit user action

## Consequences

Positive:

- Preserves the existing Gemini investment during migration.
- Keeps first import predictable.
- Opens a path to future Codex/OpenCode/Gemini/Claude/Cursor bidirectional sync.
- Avoids locking the project into Gemini as permanent source of truth.

Negative:

- Adds a second phase to the architecture.
- Requires careful handling of free-form `AGENTS.md` and `GEMINI.md`.
- Requires testing around mtime-based skill conflict behavior.
- May require a fork or wrapper if upstream behavior is too aggressive.

## Follow-up

Implement a safe adoption spike before enabling any daemon:

```bash
ogb adopt-agent-sync --dry-run
```
