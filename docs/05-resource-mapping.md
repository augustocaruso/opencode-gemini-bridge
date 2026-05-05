# Mapeamento Gemini CLI → OpenCode

| Recurso Gemini | Equivalente OpenCode | Estratégia |
|---|---|---|
| `GEMINI.md` | `instructions` | Expandir e carregar via `opencode.jsonc`. |
| `@file.md` imports | Sem equivalente garantido | Flatten script. |
| `/memory add` | Sem equivalente direto | Global `GEMINI.md` continua fonte; sync/flatten. |
| `/memory list/show` | Sem equivalente igual | `ogb doctor` e plugin/status. |
| MCP `mcpServers` | `mcp` no config | Converter. |
| MCP resources `@server://...` | Parcial | Marcar como compatibilidade futura. |
| Skills | Skills nativas OpenCode | Projetar para `.opencode/skills`. |
| Subagents | Agents/subagents OpenCode | Converter; revisar semântica. |
| Commands | `.opencode/commands` | Converter templates. |
| Hooks | Plugins/scripts/trust ledger | Mapear e confiar seletivamente por hash. |
| Gemini Extensions | OpenCode pack/plugin | Criar compatibility layer. |
| YOLO | `permission` allow | Agente `yolo` + sandbox externo. |
| Model steering | Parcial | `question`, checkpoints, interrupt. |
| Model auto/routing | Parcial | Fallback configurável por subagente, inspirado em Oh My OpenAgent. |
| Tasks/todos | `todowrite` | Ativar permissão. |
| Delegação | `task`/subagents | Ativar com `ask` inicialmente. |
| Quota/stats | TUI OGB + OpenUsage/fallback nativo | Mostrar provider atual sem misturar quotas. |
| Sidebar | TUI OGB | `USAGE LIMITS` + `BRIDGE`. |
| Headless mode | `opencode run` | Usar para automações. |
| Checkpoint/rewind | snapshots/undo | Validar comportamento no OpenCode. |
| Shell mode | bash + plugin shell strategy | Evitar comandos interativos. |

## Prioridade de compatibilidade

Alta:

1. `GEMINI.md` e imports.
2. Skills.
3. MCPs.
4. Doctor/status.
5. Quota.

Média:

1. Subagents.
2. Commands.
3. Model steering parcial.
4. Extensions.

Baixa / segura por enquanto:

1. Hooks complexos.
2. Sync bidirecional além de regras Markdown.
4. Histórico de sessão.
