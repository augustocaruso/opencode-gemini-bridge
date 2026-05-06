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
/bridge
/doctor
/status
/resources
```

Fase 2:

```text
plugin que grava status, atualiza dashboard e mostra toast quando possivel
```

Fase 2.1:

```text
plugin de startup que roda ogb sync quando OpenCode inicia
```

Fase 3:

```text
sidebar customizada se API permitir
```

Estado implementado no `0.0.14`:

```text
ogb dashboard
.opencode/generated/ogb-dashboard.json
.opencode/generated/ogb-dashboard.md
.opencode/generated/ogb-plugin-status.json
/bridge
startup plugin com toast de inicio/sucesso/falha
```

Estado implementado no `0.0.16`:

```text
.opencode/tui-plugins/ogb-sidebar.js
.opencode/tui.jsonc
sidebar_content com status OGB
```

Estado implementado no `0.0.21`:

```text
Quota com OpenAI, Claude e Gemini no formatter compacto do OGB
footer com ⏱ Ns, quota e reset
BRIDGE com OGB PASS/WARN/FAIL, sync e linha compacta de inventario
sem custo $0.00 no footer
sem hack para esconder LSP
```

O plugin TUI fica em `.opencode/tui-plugins/`, nao em `.opencode/plugins/`, para evitar que o OpenCode tente carrega-lo como plugin de servidor. O arquivo `.opencode/tui.jsonc` registra `./tui-plugins/ogb-sidebar.js`.

O painel atual mostra:

```text
Quota
OpenAI (Pro) Session       44m
████░░░░░░░░░░░░░░░░░░░░░░░░░░   13%
OpenAI (Pro) Weekly         6d
█░░░░░░░░░░░░░░░░░░░░░░░░░░░░░    3%
Claude Session           1h38m
██░░░░░░░░░░░░░░░░░░░░░░░░░░░░    6%
Claude Weekly               2d
███████░░░░░░░░░░░░░░░░░░░░░░░   23%
Gemini (Code Assist)    12h37m
█░░░░░░░░░░░░░░░░░░░░░░░░░░░░░    2%

BRIDGE
OGB PASS/WARN/FAIL
sync pass HH:MM

N GEMINI.md files · N MCP servers · N skills
```

## Painel desejado

```text
Quota
OpenAI (Pro) Session       44m
████░░░░░░░░░░░░░░░░░░░░░░░░░░   13%
OpenAI (Pro) Weekly         6d
█░░░░░░░░░░░░░░░░░░░░░░░░░░░░░    3%
Claude Session           1h38m
██░░░░░░░░░░░░░░░░░░░░░░░░░░░░    6%
Claude Weekly               2d
███████░░░░░░░░░░░░░░░░░░░░░░░   23%
Gemini (Code Assist)    12h37m
█░░░░░░░░░░░░░░░░░░░░░░░░░░░░░    2%

BRIDGE
OGB PASS
sync pass 04:09 PM

2 GEMINI.md files · 2 MCP servers · 10 skills
```

## Fontes de dados

O plugin deve ler arquivos gerados pelo bridge:

```text
.opencode/generated/ogb-inventory.json
.opencode/generated/ogb-doctor.json
.opencode/generated/ogb-sync-state.json
.opencode/generated/ogb-validation.json
.opencode/generated/ogb-security.json
.opencode/generated/ogb-extension-map.json
.opencode/generated/ogb-model-routing.json
.opencode/generated/ogb-limits.json
.opencode/generated/ogb-plugin-status.json
```

## Startup sync

Sim, dá para rodar `ogb sync` quando o OpenCode inicia.

Há duas opções:

```text
opção mais confiável: ogb launch
opção conveniente: plugin local de startup
```

### Opção A — wrapper antes do OpenCode

Fluxo:

```text
ogb sync → ogb doctor → opencode
```

Esse é o caminho mais confiável porque o OpenCode já abre com os arquivos gerados prontos.

Comando:

```bash
ogb launch
```

ou alias futuro:

```bash
alias opencode="ogb launch"
```

### Opção B — plugin local

OpenCode carrega plugins locais no startup. Um plugin pode rodar `ogb sync` quando é inicializado.

Implementação:

```text
packages/ogb/src/setup-opencode.ts
```

Instalação futura pelo bridge:

```text
.opencode/plugins/ogb-startup-sync.js
```

Comportamento:

- roda `ogb sync` por padrão;
- antes do sync, roda `ogb auto-update` por padrao;
- se uma release nova for aplicada, grava status e avisa para reiniciar o OpenCode;
- usa lock curto para evitar disparos duplicados;
- registra resultado via log do OpenCode;
- grava `.opencode/generated/ogb-plugin-status.json`;
- grava `.opencode/generated/ogb-update-status.json`;
- roda `ogb dashboard --write-only` depois do sync;
- chama `ogb telemetry record` com um resumo redigido de startup, auto-update,
  sync e dashboard;
- tenta mostrar toast na TUI quando o OpenCode permite;
- lê `.opencode/generated/ogb-startup-sync.json` para saber qual comando chamar;
- não roda `gemini extensions update --all`;
- não ativa hooks/scripts de extensão.

Instalador implementado:

```bash
ogb setup-opencode
```

Esse comando:

- cria/valida `opencode.jsonc`;
- copia `.opencode/plugins/ogb-startup-sync.js`;
- grava `.opencode/generated/ogb-startup-sync.json`;
- valida `node --check` do plugin;
- valida que o comando configurado consegue responder `--version`;
- roda `ogb doctor`, salvo com `--skip-doctor`.

Configuração por env:

```bash
OGB_STARTUP_SYNC=0                  # desliga
OGB_AUTO_UPDATE=0                   # desliga apenas auto-update do OGB
OGB_BIN=/caminho/para/ogb           # binário alternativo
OGB_STARTUP_SYNC_ARGS="sync --features extensions,context,skills"
OGB_AUTO_UPDATE_ARGS="auto-update --dry-run"
OGB_SYNC_ON_SESSION_CREATED=1       # também roda em nova sessão
```

Limitação:

```text
Se o plugin mudar opencode.jsonc, AGENTS.md ou listas de comandos/skills
depois que a sessão já começou, talvez a sessão atual precise reiniciar.
```

Por isso o plugin é bom como cinto de segurança, mas `ogb launch` continua sendo o caminho principal para garantir contexto correto na primeira mensagem.

## Commands OpenCode propostos

### `/doctor`

Executa ou mostra saída de `ogb doctor`.

### `/bridge`

Executa `ogb bridge --project "$PWD"` e resume o dashboard.

É o comando principal para o usuário final porque junta doctor, validação,
segurança, startup sync e extensões em uma resposta curta.

O comando não deve varrer a home do usuário nem editar arquivos.

### `/telemetry`

Executa `ogb telemetry status --project "$PWD"` por padrao.

Quando o usuario pedir:

- setup email para mantenedor: `ogb telemetry setup-email --project "$PWD"`;
- preview: `ogb telemetry preview --since 7d --project "$PWD"`;
- envio manual: `ogb telemetry send --since 7d --project "$PWD"`;
- desligar: `ogb telemetry disable --project "$PWD"`.

O comando nao deve exibir token. Habilitacao remota so deve usar endpoint/token
fornecidos explicitamente ou defaults privados empacotados pelo mantenedor.
Quando orientar `setup-email`, pedir apenas email de destino, remetente
verificado do Resend e API key do Resend; se o Wrangler nao estiver logado,
orientar `npm exec --yes wrangler login`.

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

## Riscos

- API de sidebar pode mudar.
- Plugins podem não conseguir injetar UI persistente.
- Excesso de status pode poluir a experiência.
- Telemetria remota nunca deve impedir startup sync, dashboard ou comandos OGB.

## Solução robusta

Mesmo que sidebar não funcione, o projeto continua útil se existir:

```text
ogb dashboard
ogb doctor
opencode command /bridge
opencode command /doctor
opencode command /resources
```
