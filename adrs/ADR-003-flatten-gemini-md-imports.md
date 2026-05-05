# ADR-003 — Flatten GEMINI.md imports

## Status

Accepted.

## Context

Gemini CLI supports `@file.md` imports inside `GEMINI.md`. OpenCode can load instruction files, but should not be assumed to expand Gemini import syntax with identical behavior.

## Decision

Generate `.opencode/generated/GEMINI.expanded.md` before launching OpenCode.

## Consequences

- OpenCode gets deterministic context.
- Missing imports and cycles can be detected.
- Generated file must not be manually edited.
