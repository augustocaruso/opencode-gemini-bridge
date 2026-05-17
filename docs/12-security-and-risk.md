# Segurança e riscos

## Risco 1 — OAuth não oficial

Usar plugin para autenticação Gemini via OAuth pode ter risco de política/abuso. Para menor risco, usar Gemini API key ou Vertex AI.

Mitigação:

- Documentar claramente.
- Não usar em conta crítica sem consentimento.
- Oferecer provider alternativo via API key.

## Risco 2 — YOLO sem sandbox

OpenCode com `edit/bash: allow` pode executar mudanças ou comandos destrutivos.

Mitigação:

- Criar agente `yolo`, não permissão global.
- Usar worktree, sandbox ou pasta descartável.
- No Windows, cuidado com PowerShell destrutivo.

## Risco 3 — Hooks/scripts de extensões

Gemini settings e Extensions podem ter hooks/scripts. O contrato atual do OGB é
sincronizar os hooks compatíveis com OpenCode sem etapa manual, porque eles
fazem parte do comportamento instalado da configuração Gemini.

Mitigação:

- `ogb sync` registra hooks/scripts de extensões em `.opencode/generated/ogb-extension-map.json`.
- Hooks `BeforeTool`/`AfterTool` de `settings.json` e extensões rodam pelo plugin OGB do OpenCode.
- Scripts soltos e eventos sem equivalente OpenCode ficam apenas inventariados.
- `ogb security-check` confirma a projeção esperada e continua verificando hashes legados.
- Nunca baixar e executar script remoto sem revisão.

## Risco 4 — Secrets em configs

MCPs podem ter env vars ou tokens.

Mitigação:

- Não copiar valores secretos para logs.
- Preservar referências `{env:VAR}`.
- Doctor deve mascarar valores sensíveis.
- Não zipar auth.json, cookies ou tokens.
- Rodar `ogb security-check` antes de empacotar/release.

## Risco 5 — Imports externos

`GEMINI.md` pode importar arquivos fora do workspace.

Mitigação:

- Mostrar warning.
- Exigir allowlist para paths externos.
- Registrar no inventory.

## Risco 6 — Conflito de fonte de verdade

Editar Gemini e OpenCode ao mesmo tempo gera conflito.

Mitigação:

- OpenCode generated files têm cabeçalho DO NOT EDIT.
- Sync one-way no MVP.
- Conflitos falham por padrão.

## Risco 7 — Context bloat

Muitos MCPs, skills e instructions podem inflar contexto.

Mitigação:

- Doctor calcula tamanho aproximado.
- Skills experimentais com `ask`.
- MCPs pesados desativados por padrão.
- Plugin/status mostra recursos ativos.

## Risco 8 — Windows paths

Mac e Windows têm diferenças de path, symlink, permissões e shell.

Mitigação:

- Testar primeiro Mac.
- Scripts separados `.sh` e `.ps1`.
- Preferir cópia segura a symlink quando necessário.
- Usar paths resolvidos e normalizados.
- Usar `ogb validate --windows` para a checagem estatica do instalador no Mac/Linux antes de testar em uma maquina Windows real.

## Checklist atual

Antes de distribuir:

```bash
ogb sync
ogb doctor
ogb validate --windows
ogb security-check
ogb bridge
```

O `ogb validate` nao chama modelo por padrao. Use `--opencode-run` so quando
quiser gastar tokens para testar uma chamada real.
