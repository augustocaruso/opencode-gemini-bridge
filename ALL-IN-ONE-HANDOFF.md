# OpenCode Gemini Bridge — all-in-one handoff


---

# File: README.md

# OpenCode Gemini Bridge

**Data de consolidação:** 2026-05-04

Este pacote documenta o projeto **OpenCode Gemini Bridge**: uma camada para usar o **OpenCode como interface primária** para estudos e automação, preservando o ecossistema já existente no **Gemini CLI**.

A ideia central:

```text
Gemini CLI = fonte da verdade atual
OpenCode   = interface principal nova
Bridge     = camada que sincroniza, converte, expande e valida recursos
```

Este pacote foi feito para você abrir no Codex ou em outro agente e continuar o projeto sem precisar reconstruir o raciocínio da conversa.

## Onde começar

Leia nesta ordem:

1. [`00-HANDOFF-FOR-CODEX.md`](00-HANDOFF-FOR-CODEX.md) — prompt pronto para colar no Codex.
2. [`docs/01-cheat-sheet.md`](docs/01-cheat-sheet.md) — visão de bolso do projeto.
3. [`docs/02-project-charter.md`](docs/02-project-charter.md) — propósito, escopo e não-escopo.
4. [`docs/04-architecture.md`](docs/04-architecture.md) — arquitetura proposta.
5. [`docs/08-mvp-roadmap.md`](docs/08-mvp-roadmap.md) — plano incremental no Mac antes do Windows.
6. [`artifacts/README.md`](artifacts/README.md) — configs, scripts e templates incluídos.

## Princípios fixados

- **Gemini-first:** o `GEMINI.md` e recursos Gemini existentes continuam sendo a fonte inicial de verdade.
- **OpenCode-primary:** o OpenCode vira a interface principal de uso diário.
- **Projeção gerada:** arquivos OpenCode gerados não devem ser editados manualmente.
- **Sincronização confiável:** toda conversão deve ser reproduzível, validável e reversível.
- **Não programação primeiro:** o foco primário é estudo e automação; programação é um caso secundário.
- **Mac primeiro, Windows depois:** prototipar no Mac, estabilizar e só então instalar no PC Windows do amigo.

## Estrutura do pacote

```text
opencode-gemini-bridge/
  README.md
  00-HANDOFF-FOR-CODEX.md
  docs/
  adrs/
  checklists/
  artifacts/
    opencode/
    bridge-cli-skeleton/
    scripts/
    github-actions/
    schemas/
```

## Atenção

Este pacote é uma especificação e um starter kit. Alguns scripts são protótipos funcionais mínimos, não uma implementação completa de produção. A documentação marca claramente o que está consolidado, o que precisa validação e o que deve ser implementado.


---

# File: 00-HANDOFF-FOR-CODEX.md

# Handoff para continuar no Codex

Cole este prompt no Codex depois de descompactar o pacote:

```text
Você está continuando o projeto OpenCode Gemini Bridge.

Objetivo: implementar uma camada robusta para usar OpenCode como interface primária para estudos e automação, preservando e sincronizando um setup existente do Gemini CLI.

Leia primeiro:
1. README.md
2. docs/01-cheat-sheet.md
3. docs/02-project-charter.md
4. docs/04-architecture.md
5. docs/08-mvp-roadmap.md
6. artifacts/README.md

Regras do projeto:
- Gemini CLI continua sendo a fonte inicial de verdade.
- GEMINI.md deve ser preservado como fonte de regras/memória.
- OpenCode consome uma projeção gerada, especialmente .opencode/generated/GEMINI.expanded.md.
- Não editar manualmente arquivos gerados.
- O foco é estudo e automação, não programação.
- O MVP deve ser testado primeiro no Mac; o deploy final será no Windows.
- Implementar incrementalmente: inventory → flatten → project config → skills → MCP sync → doctor → launch wrapper.

Tarefas iniciais sugeridas:
1. Verificar e corrigir os scripts em artifacts/scripts/.
2. Transformar artifacts/bridge-cli-skeleton em um CLI real chamado ogb.
3. Implementar ogb inventory para mapear recursos Gemini.
4. Implementar ogb flatten para expandir GEMINI.md e @imports.
5. Implementar ogb doctor para validar a projeção OpenCode.
6. Criar testes unitários para flatten, inventory e schema validation.
7. Só depois implementar sync de MCPs, subagentes, commands e extensões.

Ao fazer mudanças, mantenha a documentação sincronizada e adicione notas no CHANGELOG.md.
```

## Primeira pergunta útil para o Codex

```text
Leia a documentação do projeto e me devolva um plano de implementação do MVP em 5 passos, começando por ogb inventory e ogb flatten. Não escreva código ainda; apenas identifique lacunas, riscos e arquivos que devem ser alterados.
```


---

# File: docs/01-cheat-sheet.md

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
| Skills | `.gemini/skills` ou `.agents/skills` | `.agents/skills` | Usar `.agents/skills` como comum. |
| MCPs | `.gemini/settings.json` | `opencode.jsonc` → `mcp` | Converter/sincronizar. |
| Subagentes | `.gemini/agents` | `.opencode/agents` / `agent` | Converter e revisar. |
| Commands | Gemini custom commands/extensions | `.opencode/commands` | Converter. |
| Hooks | Gemini hooks | OpenCode plugins/scripts | Migrar seletivamente. |
| Extensões | Gemini Extensions | OpenCode pack/plugin | Criar compatibility layer. |
| Status/diagnóstico | `/memory`, `/mcp`, `/skills` | Parcial | Criar `/doctor`, `/status`, plugin/sidebar. |

## Ordem de implementação

```text
1. inventory
2. flatten GEMINI.md
3. opencode instructions funcionando
4. skills em .agents/skills
5. MCP sync
6. doctor/status
7. launch wrapper
8. subagents/commands
9. plugin/sidebar
10. Gemini Extension compatibility
11. GitHub Actions
12. deploy Windows
```

## Permissões iniciais recomendadas

```jsonc
{
  "permission": {
    "question": "allow",
    "todowrite": "allow",
    "edit": "ask",
    "bash": "ask",
    "task": "ask"
  }
}
```

## Agentes/modos recomendados

| Agente | Serve para | Permissões |
|---|---|---|
| `study` | estudo, resumos, explicações, flashcards | seguro |
| `automation` | automação local com aprovação | edit/bash ask |
| `safe` | padrão cuidadoso | ask |
| `yolo` | executar com mínima fricção | allow, idealmente sandbox |
| `deep` | raciocínio pesado | modelo melhor |
| `fast` | tarefas simples | modelo rápido |
| `review` | revisar sem modificar | read-only |
| `explore` | investigar sem editar | read-only |

## MVP real

O primeiro MVP não precisa de plugin/sidebar nem extensão completa. Ele precisa provar:

```text
GEMINI.md → flatten → OpenCode lê contexto certo → doctor confirma recursos.
```


---

# File: docs/02-project-charter.md

# Project charter

## Nome

**OpenCode Gemini Bridge** (`ogb` como comando provisório).

## Propósito

Criar uma camada robusta para usar o **OpenCode como interface primária** para estudos e automação, preservando o sistema já existente no **Gemini CLI**.

O objetivo não é apenas migrar configs. O objetivo é preservar workflows, memórias, skills, agentes, MCPs, hooks e extensões, criando uma projeção confiável para o OpenCode.

## Usuário-alvo inicial

1. Usuário que já tem um sistema sólido no Gemini CLI.
2. Quer usar OpenCode como interface principal.
3. Usa a CLI principalmente para estudos e automação, não programação.
4. Precisa testar primeiro no Mac.
5. Depois quer replicar no Windows de outra pessoa com o mínimo de fricção.

## Escopo

Incluído:

- Inventário do setup Gemini.
- Flatten de `GEMINI.md` com imports `@file.md`.
- Geração de config OpenCode.
- Sincronização de skills, MCPs, subagentes e commands.
- Doctor/status de recursos carregados.
- Configuração de plugins OpenCode recomendados.
- Compatibilidade gradual com Gemini Extensions.
- Empacotamento e validação via GitHub Actions.
- Deploy no Mac e Windows.

Fora do escopo inicial:

- Reimplementar o Gemini CLI.
- Criar um provider LLM novo.
- Criar sync bidirecional completo entre Gemini e OpenCode.
- Reproduzir 100% da UI Gemini dentro do OpenCode.
- Migrar histórico completo de conversas.

## Critério de sucesso do MVP

O MVP é bem-sucedido quando:

1. `ogb inventory` lista recursos Gemini atuais.
2. `ogb flatten` gera `.opencode/generated/GEMINI.expanded.md` corretamente.
3. OpenCode lê o arquivo expandido como instrução principal.
4. `.agents/skills` é reconhecido como pasta comum.
5. `ogb doctor` detecta imports quebrados, recursos ausentes e status básico.
6. `ogb launch` abre o OpenCode com a projeção atualizada.

## Critério de sucesso final

O projeto completo é bem-sucedido quando:

- Extensões Gemini podem ser instaladas e projetadas no OpenCode.
- Sidebar/status/plugin mostra recursos carregados e inconsistências.
- MCPs e agents são convertidos de forma previsível.
- Setup roda no Mac e Windows com scripts de instalação claros.
- O usuário não perde memórias/regras/workflows do Gemini CLI.


---

# File: docs/03-requirements.md

# Requirements

## Requisitos funcionais

### R1 — Inventário Gemini

O bridge deve detectar:

- `GEMINI.md` global e por projeto.
- Imports `@file.md` dentro de `GEMINI.md`.
- `.gemini/settings.json`.
- MCPs definidos em `mcpServers`.
- Skills em `.gemini/skills`, `~/.gemini/skills`, `.agents/skills`, `~/.agents/skills`.
- Subagentes em `.gemini/agents` e `~/.gemini/agents`.
- Commands Gemini, quando existirem.
- Hooks e scripts.
- Gemini Extensions instaladas ou referenciadas.

### R2 — Flatten de contexto

O bridge deve gerar:

```text
.opencode/generated/GEMINI.expanded.md
```

Esse arquivo deve conter:

- Conteúdo de `GEMINI.md`.
- Imports `@file.md` expandidos.
- Marcadores `BEGIN/END` por arquivo importado.
- Erros visíveis para imports ausentes.
- Proteção contra ciclo de imports.
- Ordem determinística.

### R3 — OpenCode project config

O bridge deve gerar ou atualizar:

```text
opencode.jsonc
```

com:

```jsonc
{
  "instructions": [".opencode/generated/GEMINI.expanded.md"]
}
```

### R4 — Skills

O bridge deve preferir `.agents/skills` como pasta comum.

Estratégias aceitas:

- Copiar skills de `.gemini/skills` para `.agents/skills`.
- Usar junction/symlink quando seguro.
- Marcar conflitos quando a mesma skill existe em múltiplos lugares.

### R5 — MCP sync

O bridge deve converter `mcpServers` do Gemini para o formato OpenCode `mcp`.

MCPs suportados inicialmente:

- `stdio`: `command` + `args` + `env` + `cwd`.
- `http`: quando houver `url`/`httpUrl` compatível.

MCPs parcialmente suportados:

- SSE ou campos muito específicos do Gemini.

### R6 — Subagents sync

O bridge deve converter agentes Gemini para agentes OpenCode quando possível.

A conversão deve preservar:

- Nome.
- Descrição.
- Prompt/instruções.
- Modo primário/subagente quando inferível.
- Permissões de edição/bash quando inferíveis.

A conversão deve marcar como `needs_review` quando a semântica não for segura.

### R7 — Commands sync

O bridge deve converter commands Gemini para `.opencode/commands/*.md` quando possível.

### R8 — Doctor

O bridge deve validar:

- Arquivos gerados existem.
- Imports resolvem.
- Config OpenCode é JSON/JSONC válido.
- MCPs têm comandos existentes ou URLs válidas.
- Skills têm `SKILL.md`.
- Agentes têm frontmatter válido.
- Último sync é recente.
- Warnings de compatibilidade.

### R9 — Launch

`ogb launch` deve:

1. Rodar flatten.
2. Rodar sync configurado.
3. Rodar doctor rápido.
4. Setar `OPENCODE_CONFIG_DIR`, se aplicável.
5. Abrir `opencode`.

## Requisitos não funcionais

- Idempotência: rodar `ogb sync` repetidamente não deve produzir diffs desnecessários.
- Reversibilidade: arquivos gerados devem ser marcados e apagáveis.
- Segurança: nunca copiar tokens ou secrets para logs/artifacts.
- Cross-platform: Mac primeiro, Windows depois.
- Observabilidade: doctor deve explicar claramente problemas.
- Modo dry-run: operações destrutivas devem suportar `--dry-run`.

## Requisitos de distribuição

- Possuir GitHub Actions para validar schemas.
- Possuir release pack zipado.
- Possuir instalação Mac e Windows.
- Possuir documentação para extensões.


---

# File: docs/04-architecture.md

# Arquitetura

## Visão geral

```text
Gemini source layer
  ~/.gemini/GEMINI.md
  ~/.gemini/settings.json
  ~/.gemini/agents
  ~/.gemini/skills
  Gemini Extensions
  project/GEMINI.md
  project/.gemini/*
        ↓
OpenCode Gemini Bridge
  inventory
  flatten
  sync
  doctor
  extension installer
        ↓
OpenCode projection layer
  .opencode/generated/GEMINI.expanded.md
  opencode.jsonc
  .agents/skills
  .opencode/agents
  .opencode/commands
  mcp config
        ↓
OpenCode interface layer
  OpenCode TUI
  OpenCode plugins
  sidebar/status
  providers OpenAI/Gemini
```

## Componentes

### 1. Inventory engine

Lê o estado atual do Gemini e produz um manifesto:

```text
.opencode/generated/ogb-inventory.json
```

Esse manifesto vira a base do doctor, sync e plugin/status.

### 2. Flatten engine

Expande `GEMINI.md` e imports `@file.md`, gerando:

```text
.opencode/generated/GEMINI.expanded.md
```

Motivo: OpenCode pode carregar arquivos em `instructions`, mas não deve ser assumido que ele expande imports Gemini com a mesma semântica.

### 3. Sync engine

Converte recursos Gemini para OpenCode:

- MCPs.
- Skills.
- Subagentes.
- Commands.
- Hooks selecionados.
- Extension manifests.

### 4. Doctor engine

Valida a projeção e mostra status.

Exemplo de saída ideal:

```text
OpenCode Gemini Bridge Doctor

Contexto:
  GEMINI.md principal: ok
  Imports expandidos: 14 ok, 1 ausente
  Arquivo OpenCode: .opencode/generated/GEMINI.expanded.md

Skills:
  .agents/skills: 23
  inválidas: 1

MCPs:
  convertidos: 8
  incompatíveis: 1 SSE

Agents:
  convertidos: 5
  precisam revisão: 2

Plugins:
  opencode-gemini-auth: configurado
  opencode-quota: configurado

Warnings:
  - Um import absoluto aponta para fora do workspace.
```

### 5. OpenCode plugin/status

Fase futura. Objetivo:

- Mostrar recursos carregados.
- Mostrar quota e provider.
- Mostrar último sync.
- Mostrar warnings.
- Talvez customizar sidebar se a API suportar.

Fallback enquanto a sidebar não for flexível:

- `/doctor`
- `/status`
- `/resources`
- wrapper `ogb doctor`

### 6. Gemini Extension compatibility layer

Lê extensões Gemini e instala uma projeção OpenCode.

## Fonte de verdade

A fonte de verdade inicial é Gemini:

```text
GEMINI.md
.gemini/settings.json
.gemini/agents
.gemini/skills
Gemini Extensions
```

OpenCode consome projeção gerada.

## Regra de edição

```text
Arquivos-fonte: pode editar.
Arquivos gerados: não editar manualmente.
```

Arquivos gerados devem conter cabeçalho:

```text
GENERATED BY OpenCode Gemini Bridge. DO NOT EDIT.
```

## Diretórios propostos

Projeto:

```text
project/
  GEMINI.md
  .gemini/
    settings.json
    agents/
    skills/
  .agents/
    skills/
  .opencode/
    generated/
    agents/
    commands/
  opencode.jsonc
```

Global:

```text
~/.gemini/
~/.agents/skills/
~/.config/opencode/
~/.ai/opencode-pack/
```

## Por que não sync bidirecional?

Porque gera conflitos de fonte de verdade. Para o MVP:

```text
Gemini → OpenCode
```

No futuro, pode haver import seletivo OpenCode → Gemini, mas isso deve ser uma operação explícita, não automática.


---

# File: docs/05-resource-mapping.md

# Mapeamento Gemini CLI → OpenCode

| Recurso Gemini | Equivalente OpenCode | Estratégia |
|---|---|---|
| `GEMINI.md` | `instructions` | Expandir e carregar via `opencode.jsonc`. |
| `@file.md` imports | Sem equivalente garantido | Flatten script. |
| `/memory add` | Sem equivalente direto | Global `GEMINI.md` continua fonte; sync/flatten. |
| `/memory list/show` | Sem equivalente igual | `ogb doctor` e plugin/status. |
| MCP `mcpServers` | `mcp` no config | Converter. |
| MCP resources `@server://...` | Parcial | Marcar como compatibilidade futura. |
| Skills | Skills nativas OpenCode | Usar `.agents/skills`. |
| Subagents | Agents/subagents OpenCode | Converter; revisar semântica. |
| Commands | `.opencode/commands` | Converter templates. |
| Hooks | Plugins/scripts | Migrar seletivamente. |
| Gemini Extensions | OpenCode pack/plugin | Criar compatibility layer. |
| YOLO | `permission` allow | Agente `yolo` + sandbox externo. |
| Model steering | Parcial | `question`, checkpoints, interrupt. |
| Model auto/routing | Parcial | Agentes `fast/deep/study/automation`; variants. |
| Tasks/todos | `todowrite` | Ativar permissão. |
| Delegação | `task`/subagents | Ativar com `ask` inicialmente. |
| Quota/stats | Plugin | `@slkiser/opencode-quota`. |
| Sidebar | Parcial | Plugin/status e future sidebar panel. |
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

Baixa no MVP:

1. Hooks complexos.
2. Sidebar customizada plena.
3. Sync bidirecional.
4. Histórico de sessão.


---

# File: docs/06-sync-strategy.md

# Estratégia de sincronização

## Modelo escolhido

```text
Gemini-first, one-way projection
```

Isso significa:

```text
Gemini source → Bridge → OpenCode generated files
```

## Por que não `.rulesync/` como fonte central?

Porque o setup Gemini existente já é sólido e o usuário considera `GEMINI.md` fonte de verdade inicial.

Rulesync continua útil como conversor auxiliar, mas não deve controlar a arquitetura principal.

## Fluxo diário

```text
1. Editar GEMINI.md, skills, MCPs ou agents no ecossistema Gemini/source.
2. Rodar ogb sync ou ogb launch.
3. O bridge atualiza a projeção OpenCode.
4. OpenCode usa os arquivos gerados.
```

## Arquivos gerados

Exemplos:

```text
.opencode/generated/GEMINI.expanded.md
.opencode/generated/ogb-inventory.json
.opencode/generated/ogb-doctor.json
.opencode/agents/*.md
.opencode/commands/*.md
opencode.generated.jsonc ou blocos gerados em opencode.jsonc
```

## Idempotência

`ogb sync` deve ser idempotente:

- Mesma entrada → mesma saída.
- Ordenação determinística.
- Cabeçalhos com versão do gerador.
- Sem timestamps dentro de arquivos gerados, exceto quando explicitamente configurado.

## Dry-run

Todo comando com escrita deve aceitar:

```bash
ogb sync --dry-run
ogb flatten --dry-run
ogb install-extension X --dry-run
```

## Backups

Se o bridge precisar sobrescrever arquivo existente que não tem cabeçalho gerado, deve:

1. Falhar por padrão.
2. Oferecer `--backup`.
3. Oferecer `--force` apenas explicitamente.

## Tratamento de conflitos

Exemplos:

- Skill com mesmo nome em `.gemini/skills` e `.agents/skills`.
- MCP com mesmo nome no Gemini e OpenCode.
- Agent convertido já existe manualmente no OpenCode.
- Command com mesmo nome.

Estratégia:

```text
não sobrescrever recurso manual sem confirmação;
gerar warning;
registrar conflito no doctor;
permitir política futura: prefer-gemini, prefer-opencode, fail.
```

## Rulesync

Rulesync pode ser chamado para conversões:

```bash
rulesync convert --from geminicli --to opencode --features mcp,commands,subagents,skills
```

Mas o bridge deve tratar Rulesync como:

```text
motor auxiliar opcional
```

não como:

```text
única fonte de verdade
```

## Não sincronizar automaticamente

Não migrar automaticamente:

- Histórico de conversas.
- Tokens/OAuth.
- Cookies.
- Chaves API.
- Estado interno de sessão.
- Memória externa sem consentimento.


---

# File: docs/07-opencode-config-guide.md

# Guia de configuração OpenCode

## Config global inicial

Arquivo:

```text
~/.config/opencode/opencode.jsonc
```

Template recomendado neste pacote:

```text
artifacts/opencode/global-opencode.jsonc
```

Pontos importantes:

- `question: allow` para perguntas estruturadas.
- `todowrite: allow` para checklists.
- `edit/bash/task: ask` no começo.
- `autoupdate: notify` para evitar updates silenciosos.
- `watcher.ignore` para evitar ruído.
- Plugins: Gemini auth e quota.

## Config de projeto

Arquivo:

```text
project/opencode.jsonc
```

Template:

```text
artifacts/opencode/project-opencode.jsonc
```

O ponto crítico:

```jsonc
{
  "instructions": [
    ".opencode/generated/GEMINI.expanded.md"
  ]
}
```

## Agentes recomendados

- `study`: estudo e organização.
- `automation`: automação local com aprovação.
- `safe`: cuidadoso.
- `yolo`: execução agressiva em ambiente confiável.
- `review`: read-only.
- `explore`: investigação.

Templates em:

```text
artifacts/opencode/agents/
```

## Commands recomendados

- `/doctor`
- `/sync`
- `/study`
- `/automate`
- `/review`
- `/explore`

Templates em:

```text
artifacts/opencode/commands/
```

## Plugins recomendados para MVP

1. `opencode-gemini-auth@latest`
2. `@slkiser/opencode-quota`

Depois:

3. `opencode-notify`
4. `opencode-websearch-cited`
5. `opencode-shell-strategy` ou instruções equivalentes.

## Modelo de permissões

Começar conservador:

```jsonc
{
  "permission": {
    "question": "allow",
    "todowrite": "allow",
    "edit": "ask",
    "bash": "ask",
    "task": "ask"
  }
}
```

Depois criar `yolo` separado com `edit/bash: allow`.

## Sobre YOLO

YOLO no OpenCode deve ser entendido como perfil de permissão, não necessariamente sandbox.

Para automação perigosa:

- Usar worktree.
- Usar repo descartável.
- Usar sandbox/container/devcontainer quando possível.
- No Windows, cuidado extra com comandos destrutivos.


---

# File: docs/08-mvp-roadmap.md

# Roadmap MVP

## Meta do MVP

Provar que o OpenCode consegue ser a interface principal sem perder o contexto Gemini.

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

- Copiar ou linkar `.gemini/skills` para `.agents/skills`.
- Validar `SKILL.md`.
- Marcar conflitos.

## Fase 5 — MCP sync básico

- Converter `mcpServers` stdio.
- Gerar bloco OpenCode `mcp`.
- Validar comandos existentes.
- Não tentar resolver OAuth/secrets.

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

## Depois do MVP

- Converter subagents.
- Converter commands.
- Compatibilidade com Gemini Extensions.
- Plugin/status no OpenCode.
- GitHub Actions.
- Instalador Windows.

## Não fazer no MVP

- Sync bidirecional.
- Sidebar custom complexa.
- Hooks perigosos.
- Multi-provider routing automático.
- Extensões completas.


---

# File: docs/09-plugin-and-sidebar-spec.md

# Plugin/status/sidebar spec

## Objetivo

Criar visibilidade dentro do OpenCode para o que hoje o Gemini CLI mostra melhor:

- Quantidade de `GEMINI.md` carregados.
- Imports expandidos.
- Skills disponíveis.
- MCPs ativos.
- Subagentes/agents.
- Quota/modelo/provider.
- Último sync.
- Erros de compatibilidade.

## Estado atual desejado

Inicialmente, não assumir que a sidebar do OpenCode é 100% customizável.

Fase 1:

```text
/doctor
/status
/resources
/quota
```

Fase 2:

```text
plugin que injeta status em eventos ou comandos
```

Fase 3:

```text
sidebar customizada se API permitir
```

## Painel ideal

```text
OpenCode Gemini Bridge

Mode: study
Provider: google-gemini-cli
Model: gemini-...
Quota: ok / warning / critical

Gemini context:
  root GEMINI.md: ok
  imports: 23 ok, 1 missing
  expanded: .opencode/generated/GEMINI.expanded.md

Resources:
  skills: 18
  MCPs: 7 active, 2 disabled
  agents: 6
  commands: 11

Sync:
  last sync: 2026-05-04 14:32
  status: clean
  warnings: 2
```

## Fontes de dados

O plugin deve ler arquivos gerados pelo bridge:

```text
.opencode/generated/ogb-inventory.json
.opencode/generated/ogb-doctor.json
.opencode/generated/ogb-sync-state.json
```

## Commands OpenCode propostos

### `/doctor`

Executa ou mostra saída de `ogb doctor`.

### `/resources`

Lista recursos detectados:

- Context files.
- Skills.
- MCPs.
- Agents.
- Commands.
- Extensions.

### `/sync`

Chama `ogb sync` ou orienta o usuário.

### `/quota`

Delegar ao plugin `@slkiser/opencode-quota` quando instalado.

## Riscos

- API de sidebar pode mudar.
- Plugins podem não conseguir injetar UI persistente.
- Excesso de status pode poluir a experiência.

## Solução robusta

Mesmo que sidebar não funcione, o projeto continua útil se existir:

```text
ogb doctor
opencode command /doctor
opencode command /resources
```


---

# File: docs/10-gemini-extension-compatibility.md

# Compatibilidade com Gemini Extensions

## Objetivo

Permitir distribuir facilmente pacotes que hoje seriam Gemini Extensions, mas que também projetam recursos para OpenCode.

## Por que isso importa

Gemini Extensions podem empacotar:

- Prompts.
- MCP servers.
- Custom commands.
- Themes.
- Hooks.
- Sub-agents.
- Agent skills.

Isso é exatamente a unidade de distribuição desejada para estudos e automação.

## Estratégia

Criar um instalador:

```bash
ogb install-extension <path-or-git-url>
```

Esse instalador:

1. Lê manifest da extensão Gemini.
2. Valida schema.
3. Copia/instala recursos fonte.
4. Gera projeção OpenCode.
5. Registra extensão em inventory.
6. Roda doctor.

## Mapeamento

| Gemini Extension | OpenCode projection |
|---|---|
| `GEMINI.md` / prompts | `.opencode/generated/extensions/<name>.expanded.md` + `instructions` |
| `skills/` | `.agents/skills/<extension-skill>` |
| `agents/` | `.opencode/agents/<agent>.md` |
| `commands/` | `.opencode/commands/<command>.md` |
| `mcpServers` | `mcp` config |
| `hooks/` | plugin/scripts com revisão |
| `scripts/` | `artifacts/scripts` ou extension dir |
| `theme` | baixa prioridade |

## Regras de segurança

- Hooks não devem rodar automaticamente após instalação.
- Scripts devem ser marcados como trusted/untrusted.
- Extensões de terceiros devem exigir `--trust` para ativar hooks/scripts.
- O doctor deve listar scripts executáveis.

## GitHub Actions

Ação `validate-extension` deve:

- Validar manifest.
- Verificar imports.
- Verificar skills com `SKILL.md`.
- Verificar agents com frontmatter.
- Verificar commands.
- Verificar MCPs.
- Rodar conversão dry-run.
- Publicar artefato zip.

## Resultado desejado

Instalação ideal:

```bash
ogb install-extension github:usuario/minha-extensao
ogb sync
ogb launch
```

ou no Windows:

```powershell
ogb install-extension github:usuario/minha-extensao
ogb sync
ogb launch
```


---

# File: docs/11-plugins-and-configs.md

# Plugins e configurações recomendadas

## Plugins essenciais para MVP

### 1. `opencode-gemini-auth@latest`

Uso:

- Autenticar Google/Gemini no OpenCode.
- Usar plano/cotas Gemini no OpenCode.

Atenção:

- Há risco de política/abuso ao usar OAuth do Gemini CLI em software de terceiros.
- Para menor risco, usar Gemini API key ou Vertex AI.

### 2. `@slkiser/opencode-quota`

Uso:

- Mostrar quota.
- Mostrar tokens do dia/sessão.
- Diagnóstico de provider/auth.

Ordem recomendada:

```jsonc
{
  "plugin": [
    "opencode-gemini-auth@latest",
    "@slkiser/opencode-quota"
  ]
}
```

## Plugins úteis depois

### `opencode-notify`

Notificações quando agente termina, pede permissão ou erro.

### `opencode-websearch-cited`

Pesquisa web com citações. Útil para estudos.

### `opencode-shell-strategy`

Instruções para evitar comandos interativos travados. Útil para automação.

### `opencode-background-agents`

Delegações longas em background. Adicionar apenas depois do básico estar sólido.

### `opencode-skillful`

Lazy-loading de skills se houver muitas skills.

### `opencode-pty`

Processos interativos/background. Útil para automações mais complexas.

### `opencode-supermemory`

Memória persistente externa. Não usar no começo para não competir com `GEMINI.md`.

## Config base recomendada

Ver:

```text
artifacts/opencode/global-opencode.jsonc
```

## Princípio

Adicionar plugins em camadas:

```text
auth + quota → stable
notify/websearch → convenience
background/pty/supermemory → advanced
```

Não instalar tudo no dia 1.


---

# File: docs/12-security-and-risk.md

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

Gemini Extensions podem ter hooks/scripts. Executar automaticamente é perigoso.

Mitigação:

- Hooks começam desativados.
- Exigir `--trust`.
- Doctor lista scripts executáveis.
- Nunca baixar e executar script remoto sem revisão.

## Risco 4 — Secrets em configs

MCPs podem ter env vars ou tokens.

Mitigação:

- Não copiar valores secretos para logs.
- Preservar referências `{env:VAR}`.
- Doctor deve mascarar valores sensíveis.
- Não zipar auth.json, cookies ou tokens.

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


---

# File: docs/13-testing-plan.md

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
- Skills em `.gemini/skills` e `.agents/skills`.
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
- Agent convertido com `needs_review`.
- Arquivo manual não sobrescrito.

### Doctor

Casos:

- Config válida.
- Config inválida.
- Import quebrado.
- Skill sem `SKILL.md`.
- MCP command ausente.
- Último sync ausente.

## Testes de integração no Mac

1. Criar projeto fake com Gemini resources.
2. Rodar `ogb inventory`.
3. Rodar `ogb flatten`.
4. Rodar `ogb sync`.
5. Rodar `ogb doctor`.
6. Rodar `opencode run` perguntando pelas instruções.

## Testes Windows

Depois do MVP Mac:

- PowerShell scripts.
- Paths com `C:\Users\...`.
- Junction/hardlink fallback.
- Execução via `opencode`.
- Verificar `robocopy` ou Node copy.

## GitHub Actions

Ações sugeridas:

- `npm test`.
- `npm run lint`.
- `npm run typecheck`.
- Validar schemas.
- Rodar fixture conversion.
- Empacotar release zip.


---

# File: docs/14-open-questions.md

# Open questions

## 1. Sidebar customizada

O OpenCode permite plugin e eventos, mas é necessário verificar até onde a UI/sidebar pode ser customizada hoje.

Fallback: commands `/doctor`, `/status`, `/resources`.

## 2. Gemini Extensions schema exato

Precisamos capturar o manifest exato das extensões Gemini usadas pelo usuário e validar todos os campos.

## 3. Hooks

Quais hooks Gemini são essenciais para estudo/automação? Quais são perigosos? Quais podem virar scripts e quais precisam plugin?

## 4. Auth Gemini

O usuário aceitará risco do `opencode-gemini-auth`, ou prefere Gemini API key/Vertex?

## 5. OpenAI provider

OpenAI será usado via assinatura ChatGPT/Plus/Pro no OpenCode ou API key? Isso afeta quota e billing.

## 6. Distribuição

O projeto será privado, compartilhado com amigo, ou open source?

## 7. Windows

O PC Windows do amigo terá:

- Node?
- Git?
- PowerShell 7?
- WSL?
- Permissão para symlink?

## 8. Escopo de automação

Quais automações são esperadas?

- Arquivos locais?
- Browser?
- Obsidian/Anki?
- Notion?
- Email/calendário?
- Estudos médicos?

Isso muda quais MCPs e skills devem ser prioridade.


---

# File: docs/16-feature-by-feature.md

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

- Usar `.agents/skills` global e por projeto como pasta comum.
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
- `study` e `automation` devem usar todos em tarefas longas.

## 8. Delegação paralela

### Valor

Subagentes podem investigar em paralelo.

### Solução

- Permissão `task: ask` inicialmente.
- Liberar subagentes `explore` e `review` com cautela.
- Criar commands `explore` e `review` com `subtask: true`.

## 9. Model steering

### Valor no Gemini

Usuário consegue redirecionar o agente durante a execução.

### OpenCode

Não há réplica 1:1 consolidada.

### Solução parcial

- Ativar `question: allow`.
- Instruir agente a pausar antes de decisões importantes.
- Usar `escape/session_interrupt` quando precisar parar.
- Criar modos `study`, `automation`, `safe`, `yolo`.

## 10. YOLO

### Valor

Baixa fricção.

### Solução

- Criar agente `yolo` separado.
- Não tornar permissões globais permissivas.
- Usar sandbox/worktree quando possível.

## 11. Quota/model limits

### Valor

Evitar surpresas de limite/custo.

### Solução

- Usar `@slkiser/opencode-quota`.
- Rodar `/quota_status` e `/quota`.
- Plugin de status futuro pode incorporar dados.

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

- Agentes com modelos diferentes: `fast`, `deep`, `study`, `automation`.
- Futuro roteador plugin/comando.
- Não implementar roteamento automático opaco no MVP.

## 16. Headless/automação

### Valor

Rodar tarefas programaticamente.

### Solução

- Usar `opencode run` quando apropriado.
- Wrapper `ogb launch` para TUI.
- Futuro `ogb run` para automações com contexto Gemini expandido.


---

# File: docs/17-cli-command-spec.md

# CLI command spec: `ogb`

## Objetivo

`ogb` é o comando do OpenCode Gemini Bridge.

## Comandos

### `ogb inventory`

Mapeia recursos Gemini/OpenCode.

```bash
ogb inventory
ogb inventory --json
ogb inventory --output .opencode/generated/ogb-inventory.json
```

Deve detectar:

- context files;
- imports;
- skills;
- MCPs;
- agents;
- commands;
- hooks;
- extensions.

### `ogb flatten`

Expande `GEMINI.md`.

```bash
ogb flatten
ogb flatten --input GEMINI.md --output .opencode/generated/GEMINI.expanded.md
ogb flatten --max-depth 10
```

### `ogb sync`

Gera projeção OpenCode.

```bash
ogb sync
ogb sync --dry-run
ogb sync --features mcp,skills,agents,commands
```

Features:

- `context`
- `skills`
- `mcp`
- `agents`
- `commands`
- `hooks`
- `extensions`

### `ogb doctor`

Valida estado.

```bash
ogb doctor
ogb doctor --json
ogb doctor --strict
```

Exit codes:

- `0`: ok.
- `1`: warnings em modo strict.
- `2`: erro de validação.
- `3`: erro de segurança.

### `ogb launch`

Prepara e abre OpenCode.

```bash
ogb launch
ogb launch --skip-sync
ogb launch --doctor strict
```

Fluxo:

```text
inventory → flatten → sync → doctor → opencode
```

### `ogb install-extension`

Instala/projeta extensão Gemini.

```bash
ogb install-extension ./minha-extensao
ogb install-extension github:user/repo
ogb install-extension ./minha-extensao --dry-run
ogb install-extension ./minha-extensao --trust
```

### `ogb update`

Atualiza pack/extensões.

```bash
ogb update
ogb update --extensions
ogb update --pack
```

### `ogb init`

Inicializa projeto.

```bash
ogb init
ogb init --gemini-first
```

Deve criar:

```text
.opencode/generated/
opencode.jsonc
```

sem sobrescrever arquivos manuais.

## Flags globais

```bash
--dry-run
--verbose
--quiet
--json
--project <path>
--global
--no-rulesync
--backup
--force
```

## Arquivos de estado

```text
.opencode/generated/ogb-inventory.json
.opencode/generated/ogb-doctor.json
.opencode/generated/ogb-sync-state.json
.opencode/generated/GEMINI.expanded.md
```

## Segurança

- Nunca logar secrets.
- Operações destrutivas exigem `--force`.
- Hooks/scripts exigem `--trust`.
- Arquivos manuais não devem ser sobrescritos.
