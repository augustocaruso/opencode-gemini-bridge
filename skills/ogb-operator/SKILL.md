---
name: ogb-operator
description: Use when helping an OGB user install, update, check, reset, or diagnose OpenCode Gemini Bridge without editing generated files by hand.
---

# OGB Operator

OGB means OpenCode Gemini Bridge. It connects a user's Gemini CLI resources to OpenCode.

## Mental Model

- Gemini CLI is the source of context, settings, MCPs, commands, agents, skills and extensions.
- OpenCode is where those resources are used.
- OGB installs, syncs, checks and repairs the projection from Gemini into OpenCode.

## Commands To Prefer

| Need | Command | What it does |
| --- | --- | --- |
| Install or reinstall | `ogb install` | Sets up OGB and the OpenCode profile. |
| Update | `ogb update` | Updates OGB and runs the post-update checks. |
| Check everything | `ogb check` | Runs setup, sync, doctor, validation, security-check and dashboard. |
| Reset | `ogb reset` | Rebuilds the global profile; only run when explicitly requested. |
| Help | `ogb help` | Shows available commands. |

Older commands may still work, but prefer the new names:

- `ogb pass` -> `ogb check`
- `ogb self-update` / `ogb upgrade-ogb` -> `ogb update`

## Rules

- Home is global, never an OGB project.
- Do not create `.opencode/generated` inside the user's home.
- Do not edit generated OpenCode files by hand; rerun `ogb sync` or `ogb check`.
- Do not run `ogb reset` unless the user explicitly asks.
- After install, update or sync changes, run `ogb check`.
- Treat extension hooks/scripts as review-only unless the user explicitly trusts them.

## Basic Flow

For a normal health check:

```sh
ogb --version
ogb check
```

If something still looks wrong:

```sh
ogb dashboard
ogb doctor
ogb validate
ogb security-check
```

Use `ogb sync` when the source resources changed and need to be projected again.

## Install Or Update

If `ogb` already works:

```sh
ogb update --release <tag>
ogb check
```

If `ogb` is not recognized, use the official bootstrap command from the OGB release instructions, then run `ogb check`.

## Reset

Reset is deliberate repair, not routine update.

```sh
cd ~
ogb reset --yes
ogb check
```

Use reset only from the user's home directory unless the user gives a specific project path.

## Useful Paths

```text
~/.gemini/
~/.config/opencode/
~/.config/opencode-gemini-bridge/generated/
```

On Windows, be careful with quoted paths and `.cmd` shims. If command execution looks broken, run `ogb check` and read `ogb dashboard` before changing files.
