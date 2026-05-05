# ADR-006 — Gemini Extension compatibility layer

## Status

Accepted.

## Context

Gemini Extensions are the user's desired distribution unit for prompts, MCPs, skills, agents, hooks and scripts.

## Decision

Build an `ogb install-extension` layer that reads Gemini extensions and projects them to OpenCode packs/configs.

## Consequences

- Enables distribution to the Windows machine.
- Requires schema validation and security model.
- Hooks/scripts need trust gating.
