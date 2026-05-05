# ADR-002 — OpenCode as primary interface

## Status

Accepted.

## Context

The user prefers OpenCode as the primary interface and does not like the Codex CLI interface. The project is for study and automation first.

## Decision

OpenCode becomes the main daily UI. Gemini CLI remains source/config legacy layer.

## Consequences

- Need OpenCode configs, plugins and commands.
- Need status/doctor to avoid being blind about Gemini resources.
- Need compatibility for Gemini Extensions.
