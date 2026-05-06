# Feature-by-feature: Gemini CLI → OpenCode Gemini Bridge

Este documento registra, de forma mais exaustiva, as funções discutidas e como elas devem ser preservadas ou replicadas.

## 1. `GEMINI.md`

### Valor no Gemini

Memória/regras persistentes, globais e por projeto. É a fonte inicial de verdade do usuário.

### Problema no OpenCode

OpenCode carrega instruções, mas não deve ser assumido que entende toda a semântica Gemini.

### Solução

- Manter `GEMINI.md` como fonte.
- Gerar `.opencode/generated/GEMINI.expanded.md`.
- Configurar `opencode.jsonc` com `instructions` apontando para o arquivo expandido.

## 2. Imports `@file.md`

### Valor no Gemini

Permite modularizar memória/regras.

### Problema

OpenCode não deve ser assumido como expansor de imports Gemini.

### Solução

Implementar `ogb flatten`.

Requisitos:

- Expandir imports relativos e absolutos.
- Não expandir dentro de code fences.
- Detectar ciclos.
- Reportar imports ausentes.
- Gerar marcadores por arquivo.

## 3. `/memory add`, `/memory list`, `/memory show`

### Valor no Gemini

Gerenciamento explícito de memória/contexto.

### Solução OpenCode Bridge

- Não tentar replicar `/memory add` no MVP.
- Usar `GEMINI.md` global/projeto como fonte.
- `ogb doctor` mostra arquivos e imports.
- Futuro `/memory` ou `/resources` via command/plugin.

## 4. Skills

### Valor

Especializações reutilizáveis.

### Solução

- Projetar para `.opencode/skills` e manter `.agents/skills` apenas como compatibilidade/futuro sync.
- Preferir `.opencode/skills` na projeção OpenCode canônica.
- Copiar/linkar de `.gemini/skills` se necessário.
- Validar `SKILL.md`.
- Permissões OpenCode por pattern em `permission.skill`.

## 5. MCPs

### Valor

Ferramentas e recursos externos.

### Solução

- Ler `.gemini/settings.json` e `mcpServers`.
- Converter stdio para `mcp` local OpenCode.
- Converter http/streamable quando compatível.
- Marcar SSE e recursos específicos como `needs_review`.
- Nunca copiar secrets literais em logs.

## 6. Subagentes

### Valor

Especialistas isolados que preservam contexto principal.

### Solução

- Converter `.gemini/agents/*.md` para `.opencode/agents/*.md`.
- Preservar nome, descrição e prompt.
- Inferir permissões com cautela.
- Marcar `needs_review` por padrão até validar semântica.

## 7. Tasks/todos

### Valor

Planejamento durante tarefas longas.

### Solução

- Ativar `todowrite: allow` no agente principal.
- Não depender de subagente para todo no MVP.
- Agentes importados devem poder usar todo quando a permissão permitir.
- O bridge não cria mais modos `study`/`automation` embutidos.

## 8. Delegação paralela

### Valor

Subagentes podem investigar em paralelo.

### Solução

- Permissão `task: allow` no agente YOLO; subagentes projetados de extensoes
  continuam conservadores.
- Projetar subagentes vindos de Gemini Extensions com permissões conservadoras.
- O bridge não cria mais comandos embutidos `explore`/`review`.

## 9. Model steering

### Valor no Gemini

Usuário consegue redirecionar o agente durante a execução.

### OpenCode

Não há réplica 1:1 consolidada.

### Solução parcial

- Ativar `question: allow`.
- Instruir agente a pausar antes de decisões importantes.
- Usar `escape/session_interrupt` quando precisar parar.
- Criar apenas `YOLO` embutido; outros modos devem vir de extensão ou config explícita.

## 10. YOLO

### Valor

Baixa fricção.

### Solução

- Criar agente `YOLO` separado.
- Não tornar permissões globais permissivas.
- Usar sandbox/worktree quando possível.

## 11. Quota/model limits

### Valor

Evitar surpresas de limite/custo.

### Solução

- Usar TUI do OGB com OpenUsage quando disponível.
- Usar fallback nativo OpenAI/Claude/Gemini quando possível.
- Nunca reaproveitar quota de um provider em outro.

## 12. UI/sidebar

### Valor

Visibilidade de recursos carregados.

### Solução incremental

1. `ogb doctor`.
2. Commands `/doctor`, `/resources`, `/sync`.
3. Plugin status.
4. Sidebar custom se API permitir.

## 13. Gemini Extensions

### Valor

Distribuição fácil de bundles com prompts, MCPs, skills, agents, hooks, scripts.

### Solução

- `ogb install-extension`.
- Validar manifest.
- Projetar recursos para OpenCode.
- Hooks/scripts exigem trust.
- GitHub Actions valida e empacota.

## 14. Hooks

### Valor

Automação em eventos.

### Risco

Executam código arbitrário.

### Solução

- Não ativar automaticamente.
- Converter para scripts/plugins apenas após revisão.
- Doctor lista hooks e scripts.

## 15. Modo auto de modelo

### Valor

Roteia modelo adequado.

### Solução parcial

- Fallback configurável por subagente em `.opencode/ogb.config.jsonc`.
- OGB aplica roteamento por projeção no `sync/startup`, gravando
  `.opencode/generated/ogb-model-routing.json`.
- Oh My OpenAgent/oh-my-opencode é referência de UX/arquitetura, não runtime
  padrão.
- Não fazer retry opaco no meio de uma chamada enquanto o OpenCode não expuser
  um hook seguro para isso.

## 16. Headless/automação

### Valor

Rodar tarefas programaticamente.

### Solução

- Usar `opencode run` quando apropriado.
- Wrapper `ogb launch` para TUI.
- Futuro `ogb run` para automações com contexto Gemini expandido.
