# Plano de testes

## Testes unitários

### Flatten

Casos:

- `GEMINI.md` sem imports.
- Import relativo.
- Import absoluto.
- Import com `~`.
- Import aninhado.
- Ciclo de import.
- Import ausente.
- Linha `@file.md` dentro de code fence não expande.
- Múltiplos imports na mesma linha.
- Path com espaço.

### Inventory

Casos:

- Projeto sem `.gemini`.
- Projeto com `GEMINI.md` e `.gemini/settings.json`.
- Skills em Gemini Extensions e `.opencode/skills`.
- MCPs stdio.
- MCPs HTTP.
- Agentes com frontmatter.
- Commands.

### Sync

Casos:

- Converter MCP stdio.
- Converter MCP com env.
- MCP incompatível gera warning.
- Skill duplicada gera conflito.
- Subagente de Gemini Extension projetado para `.opencode/agents`.
- Fallback configurável registrado em `.opencode/generated/ogb-model-routing.json`.
- Se o provider primario estiver acima do limite configurado, o agente projetado
  usa o proximo modelo da cadeia.
- Arquivo manual não sobrescrito.
- Gemini Extension skill copiada para `.opencode/skills`.
- Gemini Extension command `.toml` convertido para `.opencode/commands/<path>/<command>.md`.
- Hook/script aparece no source map, mas nao e executado automaticamente.
- Recurso obsoleto gerenciado é removido quando some da extensão.

### Security

Casos:

- Setup limpo passa.
- Secret de alta confianca falha.
- YOLO mantem `external_directory: ask` e `task: ask`.
- Hooks/scripts de extensoes nao sao auto-projetados.
- Hook/script confiado falha quando hash muda.

### Bidirectional sync

Casos:

- Cria `AGENTS.md` ausente a partir de `GEMINI.md`.
- Recusa alvo diferente sem `--force`.
- `--force` atualiza com backup.
- Usa `homeDir` temporário nos testes, nunca a home real.

### Agent rules sync adoption

Casos:

- Regras Gemini globais aparecem como candidatas a sync.
- Arquivos gerados pelo `ogb` aparecem como `observe`, nao `sync`.
- O comando nao instala daemon nem escreve configs de terceiros.

### Doctor

Casos:

- Config válida.
- Config inválida.
- Import quebrado.
- Skill sem `SKILL.md`.
- MCP command ausente.
- Último sync ausente.

### Dashboard

Casos:

- Consolida doctor, validation, security e plugin status.
- Escreve `.opencode/generated/ogb-dashboard.json`.
- Escreve `.opencode/generated/ogb-dashboard.md`.
- Mostra `PASS`, `WARN` ou `FAIL` em linguagem simples.
- Nao chama modelo.

## Testes de integração no Mac

1. Criar projeto fake com Gemini resources.
2. Rodar `ogb inventory`.
3. Rodar `ogb flatten`.
4. Rodar `ogb sync`.
5. Rodar `ogb doctor`.
6. Rodar `ogb validate`.
7. Rodar `ogb security-check`.
8. Rodar `ogb dashboard`.
9. Rodar `opencode debug config` e conferir `YOLO`, MCPs e commands.
10. Rodar `opencode run` apenas quando quiser validar modelo real.

## Testes Windows

Depois do MVP Mac:

- PowerShell scripts.
- Paths com `C:\Users\...`.
- Junction/hardlink fallback.
- Execução via `opencode`.
- Verificar `robocopy` ou Node copy.
- `ogb validate --windows` para checagem estatica do instalador.

## GitHub Actions

Ações sugeridas:

- `npm test`.
- `npm run typecheck`.
- `npm run build`.
- `node --check dist/tui-sidebar.js`.
- `npm pack --dry-run`.
- Validar schemas.
- Rodar fixture conversion.
- Empacotar release zip.
