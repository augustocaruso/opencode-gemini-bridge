# ADR-004 — Rulesync as helper, not core source

## Status

Accepted.

## Context

Rulesync can convert between tools and supports Gemini CLI/OpenCode features. However, the user's existing source of truth is Gemini, not `.rulesync/`.

## Decision

Use Rulesync as an optional helper for MCPs, commands, subagents and skills, but implement bridge-owned inventory/flatten/doctor.

## Consequences

- More control.
- Less dependence on Rulesync behavior for import semantics.
- More implementation work.
