# Sources and verification notes

Última verificação: 2026-05-05.

Estas fontes foram usadas para consolidar decisões. Revalidar antes de publicar ou implementar em produção.

## OpenCode

- Config: https://opencode.ai/docs/config/
- Permissions: https://opencode.ai/docs/permissions/
- Agents: https://opencode.ai/docs/agents/
- MCP servers: https://opencode.ai/docs/mcp-servers/
- Skills: https://opencode.ai/docs/skills/
- Plugins: https://opencode.ai/docs/plugins/
- Tools, including `question`: https://opencode.ai/docs/tools/
- Commands: https://opencode.ai/docs/commands/
- Ecosystem plugins: https://opencode.ai/docs/ecosystem/

## Gemini CLI

- Main docs: https://geminicli.com/docs/
- Extension reference: https://geminicli.com/docs/extensions/reference/
- Agent Skills management: https://geminicli.com/docs/cli/using-agent-skills/
- GEMINI.md context: https://geminicli.com/docs/cli/gemini-md/
- Hooks reference: https://geminicli.com/docs/hooks/reference/
- Extensions: https://github.com/google-gemini/gemini-cli/blob/main/docs/extensions/index.md
- MCP servers: https://geminicli.com/docs/tools/mcp-server/
- Subagents: https://geminicli.com/docs/core/subagents/
- Gemini CLI repo: https://github.com/google-gemini/gemini-cli

## Bridge/helper tools

- Rulesync: https://github.com/dyoshikawa/rulesync
- Rulesync docs: https://rulesync.dyoshikawa.com/reference/cli-commands.html
- agent-rules-sync PyPI: https://pypi.org/project/agent-rules-sync/
- agent-rules-sync GitHub: https://github.com/dhruv-anand-aintech/agent-rules-sync
- Agentlink: https://agentlink.run/
- AGENTS.md open format: https://github.com/agentsmd/agents.md
- opencode-gemini-auth: https://github.com/jenslys/opencode-gemini-auth
- opencode-quota: https://github.com/slkiser/opencode-quota

## Important verification notes

- OpenCode config supports JSON/JSONC and merged config locations.
- OpenCode permissions use allow/ask/deny.
- OpenCode agents include primary agents and subagents.
- OpenCode MCPs are configured under `mcp`.
- OpenCode skills can be controlled via `permission.skill`.
- OpenCode plugins can be loaded locally or from npm.
- OpenCode now documents TUI-specific settings in `tui.json`/`tui.jsonc`; legacy
  TUI keys inside `opencode.json` are deprecated/migrated when possible.
- OpenCode plugins can depend on config-directory `package.json` dependencies,
  which OpenCode installs at startup.
- Gemini CLI extensions can package prompts, MCP servers, commands, themes, hooks, subagents and skills.
- Gemini CLI extension management commands run outside interactive mode; updates take effect after restarting the CLI session.
- Gemini CLI installs extensions as a local copy under `~/.gemini/extensions`; `gemini extensions update` pulls updates from source.
- Gemini CLI extension hooks live in `hooks/hooks.json`, not inside `gemini-extension.json`.
- Gemini CLI extension skills live under `skills/<name>/SKILL.md`.
- Gemini CLI extension subagents live under `agents/*.md`; subagents are marked preview in current docs.
- Gemini CLI discovers skills by precedence: built-in, extension, user, workspace; higher-precedence duplicate names win.
- Gemini CLI hooks communicate through JSON on stdin/stdout and must not print plain text to stdout.
- Rulesync supports multiple agent tools and features including rules, commands, MCP, subagents and skills.
- Rulesync `convert` can translate `geminicli` to `opencode` without adopting `.rulesync/`; the bridge should still run it in staging and promote safely.
- agent-rules-sync supports Codex/OpenCode/Gemini/Claude/Cursor paths for rules and skills, but its rules parser expects `# Shared Rules` and `## <Agent> Specific` bullet sections.
- agent-rules-sync should not be installed directly during exploration because its package install path can set up a persistent daemon.
- Agentlink is useful as a symlink-based reference, but it is intentionally narrow and does not solve feature conversion.
- opencode-gemini-auth warns about policy risk of using Gemini CLI OAuth in third-party software.

## Plugin exploration notes - 2026-05-05

Current candidate references:

- opencode-auto-fallback: https://github.com/HyeokjaeLee/opencode-auto-fallback
- opencode-quota: https://github.com/slkiser/opencode-quota
- opencode-update-notifier: https://github.com/tim-hilde/opencode-update-notifier
- opencode-dynamic-context-pruning: https://github.com/Opencode-DCP/opencode-dynamic-context-pruning
- opencode-tool-search: https://github.com/M0Rf30/opencode-tool-search
- opencode-websearch-cited: https://github.com/ghoulr/opencode-websearch-cited
- opencode-models-discovery: https://github.com/yuhp/opencode-models-discovery
- opencode-vibeguard: https://github.com/inkdust2021/opencode-vibeguard
- opencode-pty: https://github.com/shekohex/opencode-pty
- opencode-background-agents: https://github.com/kdcokenny/opencode-background-agents
- opencode-notify: https://github.com/kdcokenny/opencode-notify
- opencode-skillful: https://github.com/zenobi-us/opencode-skillful
- opencode-supermemory: https://github.com/supermemoryai/opencode-supermemory

Local npm metadata spot-checks on 2026-05-05:

- `opencode-gemini-auth`: 1.4.12, MIT, modified 2026-05-02.
- `@ex-machina/opencode-anthropic-auth`: 1.8.0, modified 2026-04-28.
- `@slkiser/opencode-quota`: 3.6.2, MIT, modified 2026-05-03.
- `opencode-auto-fallback`: 0.4.2, MIT, modified 2026-05-03.
- `opencode-websearch-cited`: 1.2.0, Apache-2.0, modified 2026-01-10.
- `opencode-pty`: 0.3.4, MIT, modified 2026-04-20.
- `@tarquinen/opencode-dcp`: 3.1.9, AGPL-3.0-or-later, modified 2026-04-05.
- `@zenobius/opencode-skillful`: 1.2.5, modified 2026-02-13.
- `opencode-supermemory`: 2.0.6, MIT, modified 2026-03-27.
- `opencode-vibeguard`: 0.1.0, MIT, modified 2026-02-28.
- `opencode-models-discovery`: 0.8.0, MIT, modified 2026-04-27.
- `opencode-update-notifier`: 0.1.0, MIT, modified 2026-05-04.
- `opencode-tool-search`: 0.4.3, MIT, modified 2026-04-18.
- `opencode-notifier`: npm package unavailable/unpublished during spot-check.
- `opencode-md-table-formatter` and `opencode-morph-fast-apply`: listed in
  ecosystem/GitHub, but not available under those npm names during spot-check.
