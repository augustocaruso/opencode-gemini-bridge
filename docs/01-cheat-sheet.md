# Cheat sheet do projeto

## Ideia central

```text
Gemini CLI = fonte da verdade atual
OpenCode   = interface principal nova
Bridge     = camada que sincroniza/converte/expande recursos
```

## Regra de ouro

```text
Edite no Gemini/source → rode sync/flatten → use no OpenCode.
Não edite manualmente arquivos gerados do OpenCode.
```

## Mapa rápido

| Área | Hoje no Gemini | No OpenCode | Estratégia |
|---|---|---|---|
| Memória/regras | `GEMINI.md` | `instructions` / `AGENTS.md` | Manter `GEMINI.md`; gerar `GEMINI.expanded.md`. |
| Imports | `@./arquivo.md` | Sem expansão 1:1 | Script `flatten`. |
| Skills | `skills/` em Gemini Extensions | `.opencode/skills` | Projetar com hash/conflito. |
| MCPs | `.gemini/settings.json` | `opencode.jsonc` → `mcp` | Converter/sincronizar. |
| Subagentes | `agents/` em Gemini Extensions | `.opencode/agents` | Projetar com permissões conservadoras. |
| Commands | Gemini custom commands/extensions | `.opencode/commands` | Converter. |
| Hooks | Gemini hooks | trust ledger | Mapear; confiar só por `ogb trust-extension`. |
| Extensões | Gemini Extensions | projeção OpenCode | Gemini continua pacote publicável. |
| Status/diagnóstico | `/memory`, `/mcp`, `/skills` | `/bridge`, `/doctor`, sidebar | dashboard + plugin de startup + TUI. |

## Ordem de implementação

```text
1. inventory
2. flatten GEMINI.md
3. opencode instructions funcionando
4. skills em .opencode/skills
5. MCP sync
6. doctor/status/dashboard
7. launch wrapper
8. subagents/commands de extensões
9. plugin/status visual e quotas
10. trust de hooks/scripts
11. sync bidirecional rules-only
12. GitHub Actions
13. deploy Windows
```

## Permissões iniciais recomendadas

```jsonc
{
  "permission": {
    "question": "allow",
    "todowrite": "allow",
    "edit": "ask",
    "bash": "ask",
    "task": "allow"
  }
}
```

## Agente/modo implementado pelo bridge

| Agente | Serve para | Permissões |
|---|---|---|
| `YOLO` | executar com mínima fricção quando escolhido explicitamente | `edit`/`bash`/`task`/diretório externo allow |

## MVP real

O primeiro MVP já passou da prova inicial. O alvo atual é:

```text
Gemini Extension → ogb sync → OpenCode com contexto, MCP, skills, comandos, agentes, quota e status.
```
