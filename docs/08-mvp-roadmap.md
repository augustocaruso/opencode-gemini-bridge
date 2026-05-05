# Roadmap MVP

## Meta do MVP

Provar que o OpenCode consegue ser a interface principal sem perder o contexto Gemini.

## Estado implementado em 0.0.21

O MVP deixou de ser só esqueleto. Hoje o bridge já cobre:

- `ogb import`, `ogb sync`, `ogb setup-opencode`, `ogb launch`;
- startup sync com recuperação de status preso;
- projeção de MCPs, skills, comandos e subagentes de Gemini Extensions;
- agente embutido `YOLO`;
- comandos OpenCode embutidos sem `/study`, `/automate`, `/review` e `/explore`;
- sidebar/footer TUI com limites OpenAI, Claude e Gemini, timer discreto e bloco `BRIDGE`;
- `ogb limits`/`ogb quota` para atualizar uso de provider;
- `ogb trust-extension` para registrar confiança seletiva em hooks/scripts revisados;
- `ogb trust-report` para listar hooks/scripts por extensão, comandos
  detectados e status de trust por hash;
- `ogb bidirectional-sync` para sincronizar regras Markdown de usuário entre Gemini, OpenCode e Codex com preview, conflito e backup;
- `ogb validate`, `ogb security-check`, `npm test`, `npm run build` e `npm pack --dry-run` como checks mínimos.

O que continua propositalmente conservador:

- hooks/scripts de extensão não rodam automaticamente;
- sync bidirecional ainda é rules-only;
- fallback de modelo e esforco por subagente sao configuráveis; o OGB aplica
  roteamento por projeção no `sync/startup`, usando o cache de limites;
- `opencode-auto-fallback` pode ser habilitado como complemento de runtime, e
  `doctor/dashboard` avisam quando plugin, config ou modelos estão faltando;
- Windows fica depois do instalador Mac.

## Fase 0 — Preparação

- Instalar OpenCode no Mac.
- Instalar Gemini CLI existente/validar setup.
- Criar repo do projeto bridge.
- Descompactar este pacote.
- Verificar `opencode auth login` para OpenAI e Gemini, se aplicável.

## Fase 1 — Inventory

Comando:

```bash
ogb inventory
```

Saída esperada:

```text
GEMINI.md files: N
imports: N
skills: N
MCPs: N
agents: N
commands: N
hooks: N
extensions: N
```

Artefato:

```text
.opencode/generated/ogb-inventory.json
```

## Fase 1.5 — Importação inicial suave

Comando:

```bash
ogb import
```

Executa:

```text
init → inventory → flatten → sync → doctor
```

Rulesync entra como auxiliar opcional:

```bash
ogb import --rulesync auto
ogb import --rulesync require
ogb import --rulesync off
```

Garantias:

- Não copiar `~/.gemini` inteiro para dentro do projeto.
- Não gravar secrets em logs.
- Rodar Rulesync em staging temporário.
- Promover apenas arquivos novos ou já gerenciados.
- Registrar hashes em `.opencode/generated/ogb-sync-state.json`.

## Fase 1.6 — Extensões Gemini instaladas

Dor principal:

```text
Gemini Extensions já são nosso pacote de distribuição e auto-update.
```

No MVP, `ogb inventory` e `ogb doctor` devem reconhecer extensões instaladas em:

```text
~/.gemini/extensions/
project/.gemini/extensions/
```

e marcar como `needs_review`.

O sync inicial deve tratar extensões como fonte empacotada, não como arquivos soltos:

```text
Gemini Extension instalada → projeção OpenCode/Codex gerada
```

Não ativar hooks/scripts automaticamente.

## Fase 2 — Flatten

Comando:

```bash
ogb flatten
```

Saída:

```text
.opencode/generated/GEMINI.expanded.md
```

Testes:

- Import simples.
- Import aninhado.
- Ciclo de import.
- Import ausente.
- Import dentro de code fence não deve expandir.

## Fase 3 — OpenCode instructions

Gerar/validar:

```jsonc
{
  "instructions": [".opencode/generated/GEMINI.expanded.md"]
}
```

Teste:

```bash
opencode run "Resuma as instruções do projeto sem editar arquivos."
```

## Fase 4 — Skills

- Projetar skills de Gemini Extensions para `.opencode/skills/<skill>/SKILL.md`.
- Validar `SKILL.md`.
- Marcar conflitos.

## Fase 5 — MCP sync básico

- Converter `mcpServers` stdio.
- Gerar bloco OpenCode `mcp`.
- Validar comandos existentes.
- Não tentar resolver OAuth/secrets.
- Usar Rulesync como comparação/conversor auxiliar quando disponível.

## Fase 6 — Doctor

Comando:

```bash
ogb doctor
```

Deve mostrar status claro e warnings.

## Fase 7 — Launch wrapper

Comando:

```bash
ogb launch
```

Executa:

```text
inventory → flatten → sync básico → doctor rápido → opencode
```

Esse é o caminho principal para garantir que OpenCode já abra com contexto, skills, comandos e extensões projetados.

## Fase 7.5 — Startup sync plugin

Artefato:

```text
artifacts/opencode/plugins/ogb-startup-sync.js
```

Objetivo:

```text
rodar ogb sync quando o plugin do OpenCode é carregado
```

Uso recomendado:

- como cinto de segurança;
- para usuários que abrem `opencode` direto;
- para registrar log quando sync falha.

Limitação:

- se o sync alterar config/contexto depois da sessão já ter iniciado, pode ser necessário abrir nova sessão.

## Fase 7.6 — Dashboard e comando `/bridge`

Comando:

```bash
ogb dashboard
```

Artefatos:

```text
.opencode/generated/ogb-dashboard.json
.opencode/generated/ogb-dashboard.md
.opencode/generated/ogb-plugin-status.json
```

Objetivo:

```text
dar um painel simples, legivel e consultavel pelo OpenCode sem depender de sidebar customizada
```

## Fase 7.7 — TUI sidebar/footer

Artefatos:

```text
.opencode/tui-plugins/ogb-sidebar.js
.opencode/tui.jsonc
```

Estado atual:

```text
Quota
OpenAI/Claude/Gemini no formatter compacto inspirado em @slkiser/opencode-quota
BRIDGE
MCP nativo do OpenCode
LSP nativo do OpenCode quando habilitado
footer com timer e quota/reset do provider atual
```

O footer não mostra custo `$0.00`. O status `OGB PASS/WARN/FAIL` fica na sidebar, não no rodapé.

Critérios visuais pendentes:

- validar após reiniciar OpenCode;
- confirmar que todos os providers aparecem quando há dados;
- confirmar que a barra representa uso, não quota restante;
- confirmar que percentual e barra ficam na mesma linha sem wrap;
- testar a sidebar em largura estreita e larga.

## Fase 7.8 — Extensões e trust

`ogb sync` projeta comandos, skills, MCPs e subagentes das extensões instaladas.
Hooks/scripts entram apenas no mapa de risco:

```text
.opencode/generated/ogb-extension-map.json
```

Para confiar em um hook/script revisado:

```bash
ogb trust-report medical-notes-workbench
ogb trust-extension <extensao> --hook hooks/hooks.json
ogb security-check
```

Se o hash mudar depois, o `security-check` falha até nova revisão.

## Fase 7.9 — Sync bidirecional seguro

Primeira versão:

```bash
ogb bidirectional-sync --dry-run
ogb bidirectional-sync --force
ogb sync --bidirectional --dry-run
```

Escopo inicial:

```text
GEMINI.md / AGENTS.md de projeto
~/.gemini/GEMINI.md
~/.config/opencode/AGENTS.md
~/.codex/AGENTS.md
```

Arquivos diferentes viram conflito por padrão. Com `--force`, o OGB cria backup antes de atualizar.

No OpenCode:

```text
/bridge
```

O plugin de startup sync atualiza esse dashboard depois de rodar `ogb sync` e tenta mostrar toast de sucesso/falha.

## Fluxo diário do MVP

```bash
ogb sync
ogb doctor
ogb dashboard
opencode
```

Use `ogb sync --dry-run` antes de mudanças grandes e `ogb sync --force` apenas quando o conflito for entendido.

## Depois do MVP

- Explorar `agent-rules-sync` como base para sync bidirecional pós-bootstrap.
- Criar `ogb adopt-agent-sync --dry-run` para avaliar arquivos globais sem escrever.
- Evoluir sync bidirecional alem do escopo rules-only.
- Fortalecer `update-extensions` para remover recursos obsoletos automaticamente.
- Validar runtime fallback externo com falha simulada de provider/modelo.
- Validar visualmente a sidebar em OpenCode real depois de reiniciar.
- Instalador Windows.

## Não fazer no MVP

- Sync bidirecional alem de regras Markdown com preview/backup.
- Sidebar custom complexa.
- Hooks/scripts sem trust explícito.
- Retry opaco no meio de uma tarefa sem registrar modelo/motivo.
