# ADR-001 — Gemini-first source of truth

## Status

Accepted.

## Context

The user already has a mature Gemini CLI setup with `GEMINI.md`, skills, MCPs, subagents, hooks and extensions.

## Decision

Gemini remains the initial source of truth. OpenCode receives generated projections.

## Consequences

Positive:

- Preserves existing investment.
- Avoids forcing a full migration before use.
- Reduces risk of losing memory/rules.

Negative:

- Requires one-way sync machinery.
- Some OpenCode-specific improvements must be carefully separated.
- Sync conflicts need explicit handling.
