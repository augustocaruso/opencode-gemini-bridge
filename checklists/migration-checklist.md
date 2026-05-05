# Migration checklist

## Gemini resources

- [ ] List global `~/.gemini/GEMINI.md`.
- [ ] List project `GEMINI.md`.
- [ ] List imports.
- [ ] List `.gemini/settings.json` MCPs.
- [ ] List skills.
- [ ] List agents/subagents.
- [ ] List commands.
- [ ] List hooks.
- [ ] List extensions.

## OpenCode projection

- [ ] Generate expanded context.
- [ ] Configure `instructions`.
- [ ] Move/sync skills to `.agents/skills`.
- [ ] Convert MCPs.
- [ ] Convert agents.
- [ ] Convert commands.
- [ ] Disable hooks unless trusted.

## Verify

- [ ] Doctor clean or warnings understood.
- [ ] OpenCode can summarize loaded instructions.
- [ ] Quota plugin works.
- [ ] Gemini provider works or API key fallback works.
- [ ] Study mode works.
- [ ] Automation mode asks before commands.
