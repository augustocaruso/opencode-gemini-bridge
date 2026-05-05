# ADR-005 — Status plugin and sidebar as later phase

## Status

Accepted. Implemented in `0.0.16`.

## Context

The user wants visibility similar to Gemini UI: count of memory files, MCPs, skills, quota and mode. OpenCode may not expose a mature arbitrary sidebar API yet.

## Decision

Start with `ogb doctor` and OpenCode commands `/doctor`, `/status`, `/resources`.

After checking OpenCode `1.14.33`, the TUI plugin API exposes `sidebar_title`, `sidebar_content` and `sidebar_footer` slots. The bridge now implements a conservative sidebar plugin that appends an OGB status block through `sidebar_content`.

## Consequences

- Useful diagnostics early.
- Avoids blocking on UI internals.
- Plugin can consume generated JSON state.
- Sidebar customization remains additive. Full sidebar redesign still requires an OpenCode fork or a deeper upstream API.
