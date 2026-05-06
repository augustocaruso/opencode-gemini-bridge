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
ogb sync --rulesync auto
ogb sync --rulesync require
ogb sync --rulesync off
```

Features:

- `context`
- `skills`
- `mcp`
- `agents`
- `commands`
- `hooks`
- `extensions`

Rulesync:

- `auto`: usar se disponível, pular com warning se ausente.
- `require`: falhar se não estiver disponível.
- `off`: usar apenas implementação nativa do bridge.

O bridge roda Rulesync em staging temporário e promove outputs de forma segura por hash.

Fora do diretorio home, `ogb sync` gera a projeção de projeto em `.opencode/`.
Dentro do home, ele sincroniza como global: `~/.gemini/GEMINI.md`,
`~/.gemini/commands/`, `~/.gemini/agents/`, `~/.gemini/skills/` e recursos
equivalentes de extensoes Gemini sao projetados para `~/.config/opencode/`.
O `GEMINI.md` global e os `GEMINI.md` das extensoes Gemini passam antes por
expansao de imports em
`~/.config/opencode-gemini-bridge/generated/GEMINI.expanded.md`; o config
global `~/.config/opencode/opencode.json` recebe esse caminho em
`instructions`. MCPs globais compativeis entram no campo `mcp` do mesmo config.
O `~/.config/opencode/AGENTS.md` e sobrescrito pelo preset OGB no `setup-ux` e
no `reset`, mas nao e usado como fonte canonica do sync Gemini.

Em projetos, tambem projeta os comandos OpenCode embutidos:

```text
/bridge
/doctor
/sync
/resources
/validate
/security-check
/telemetry
/agent-sync
/status
/update-extensions
/upgrade-ogb
```

Tambem projeta comandos `.toml` de Gemini Extensions instaladas como comandos
OpenCode. O nome natural é preservado quando não há colisão; o prefixo/índice
entra apenas quando necessário:

```text
.opencode/commands/<path>/<command>.md
```

Exemplo:

```text
~/.gemini/extensions/medical-notes-workbench/commands/mednotes/create.toml
→ .opencode/commands/mednotes/create.md
```

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

### `ogb dashboard`

Gera um painel simples para o uso diario.

```bash
ogb dashboard
ogb bridge
ogb dashboard --json
ogb dashboard --write-only
ogb dashboard --no-refresh
ogb dashboard --strict
```

Arquivos:

```text
.opencode/generated/ogb-dashboard.json
.opencode/generated/ogb-dashboard.md
```

Ele consolida:

- `ogb doctor`;
- `ogb validate`, quando ja tiver rodado;
- `ogb security-check`, quando ja tiver rodado;
- ultimo startup sync do plugin;
- status local de telemetria;
- contagem de MCPs, skills, agentes, comandos e extensoes.

Tambem escreve:

```text
.opencode/generated/ogb-telemetry-status.json
```

Esse arquivo nunca inclui o token remoto.

### `ogb pass`

Roda o caminho verde completo e escreve `.opencode/generated/ogb-pass.json`.

```bash
ogb pass
ogb pass --accept-hooks
ogb pass --force
ogb pass --json
```

O comando executa setup local, sync, doctor, validation, security-check e
dashboard. `--accept-hooks` registra por hash os hooks Gemini revisados; se o
arquivo mudar, o doctor volta a pedir revisão.

### `ogb limits`

Atualiza e mostra limites de uso por provider.

```bash
ogb limits
ogb limits --cached
ogb limits --json
ogb limits --strict
```

Fontes:

- OpenUsage quando disponível;
- fallback OAuth nativo do OpenCode para OpenAI/Claude quando possível;
- `gemini_quota`/cache Gemini para Gemini Code Assist.

Nunca reaproveita quota de um provider para outro.

### `ogb telemetry`

Gerencia telemetria local-first do OGB. A telemetria sempre e fail-open: nunca
muda exit code, stdout ou stderr real de um comando.

```bash
ogb telemetry status
ogb telemetry setup-email
ogb telemetry enable --endpoint https://worker.example/v1/telemetry/workflow-runs --token "$TOKEN"
ogb telemetry enable --endpoint https://worker.example/v1/telemetry/workflow-runs --token "$TOKEN" --payload-level full_logs
ogb telemetry disable
ogb telemetry preview --since 7d
ogb telemetry send --since 7d
ogb telemetry send --since 7d --include-pass
ogb telemetry record --workflow startup-plugin --status completed --payload -
```

`preview` mostra o historico local completo. `send` normal envia remotamente
apenas problemas acionaveis: falhas, warnings, errors e updates que exigem
restart. Passes limpos ficam locais. `--include-pass` existe apenas para debug
manual do canal remoto.

Arquivos locais:

```text
~/.config/opencode-gemini-bridge/telemetry/config.json
~/.config/opencode-gemini-bridge/telemetry/runs/*.json
~/.config/opencode-gemini-bridge/telemetry/outbox/*.json
~/.config/opencode-gemini-bridge/telemetry/telemetry-sent.json
```

Schemas:

```text
opencode-gemini-bridge.workflow-run-record.v1
opencode-gemini-bridge.workflow-telemetry-envelope.v1
opencode-gemini-bridge.telemetry-status.v1
```

Privacidade:

- default `payload_level` e `diagnostic_redacted`;
- `full_logs` continua redigido, mas inclui mais contexto diagnostico;
- tokens, auth headers, cookies, emails, query strings e strings longas sao redigidos;
- conteudo de `GEMINI.md`, `.env`, OAuth/auth configs, prompts completos e arquivos
  do projeto nao deve ser enviado;
- caminhos viram rotulos curtos e hashes quando entram em payload resumido.

Defaults privados:

- `telemetry.defaults.example.json` fica versionado como molde;
- `.telemetry-defaults.json` fica ignorado localmente;
- `packages/ogb/telemetry.defaults.json` fica ignorado pelo
  Git, mas entra no pacote npm/tarball quando existe;
- runtime le `telemetry.defaults.json` perto do pacote instalado ou
  `OGB_TELEMETRY_DEFAULTS`;
- defaults so podem conter `enabled`, `endpoint_url`, `auth_token`,
  `payload_level`, `max_envelope_bytes`;
- depois de `ogb telemetry disable`, defaults nao reativam a instalacao.

Setup email:

```bash
ogb telemetry setup-email \
  --to-email mantenedor@example.com \
  --from-email telemetry@example.com \
  --activate-local
```

O comando prepara o Worker local em
`~/.config/opencode-gemini-bridge/telemetry-email-worker/`, usa o Wrangler
autenticado da maquina para criar KV opcional, gravar secrets e fazer deploy,
envia um email de teste via Resend e grava
`~/.config/opencode-gemini-bridge/telemetry-receiver.json`. Por padrao tambem
grava `telemetry.defaults.json` no pacote para builds privados. Esse defaults
autoativa telemetria remota nas instalacoes dos usuarios, sem expor a chave do
Resend; usuarios ainda podem rodar `ogb telemetry disable`.

Em releases montadas pelo GitHub Actions, o secret
`OGB_TELEMETRY_DEFAULTS_JSON` deve conter o JSON inteiro de
`telemetry.defaults.json`; o workflow restaura esse arquivo antes do `npm pack`
e do zip de release.

Worker:

```text
packages/ogb/telemetry-email-worker/
```

O template Cloudflare Worker expoe `GET /health`,
`POST /v1/telemetry/workflow-runs` e
`POST /v1/telemetry/digest/send`, exige Bearer token e usa Resend/KV quando
configurados. Com KV, ele agrega digest a cada 15 minutos via cron; sem KV,
envia um email imediato por envelope.

### `ogb bidirectional-sync`

Sincroniza regras Markdown de usuário entre Gemini, OpenCode e Codex.

```bash
ogb bidirectional-sync --dry-run
ogb bidirectional-sync --force
ogb sync --bidirectional --dry-run
```

Escopo inicial:

```text
GEMINI.md / AGENTS.md do projeto
~/.gemini/GEMINI.md
~/.config/opencode/AGENTS.md
~/.codex/AGENTS.md
```

Conflitos não são sobrescritos sem `--force`. Com `--force`, o OGB cria backup
em `.opencode/backups/bidirectional-sync/`.

### `ogb validate`

Valida o fluxo instalado de ponta a ponta, sem chamar modelo por padrao.

```bash
ogb validate
ogb validate --windows
ogb validate --strict
ogb validate --opencode-run
```

O `--opencode-run` e opcional porque pode gastar tokens.

### `ogb self-update`

Atualiza o OGB a partir do GitHub Release oficial e reaplica o perfil local.

```bash
ogb --project "$PWD" self-update
ogb --project "$PWD" self-update --dry-run
ogb --project "$PWD" self-update --release v0.0.33
ogb --project "$PWD" self-update --no-setup
```

Atalho equivalente:

```bash
ogb --project "$PWD" upgrade-ogb
```

Modelo mental:

```text
GitHub Release pack
  -> bootstrap oficial
  -> instalador macOS/Windows
  -> ogb setup-ux/import/setup-opencode/doctor/validate
```

O comando nao sincroniza nem copia conteudo unico do Gemini CLI de outra
pessoa. Ele apenas atualiza o `ogb`, reinstala/reaplica settings e plugins do
OpenCode e depois deixa o `ogb sync` projetar o conteudo Gemini local.

### `ogb reset`

Reseta a instalacao global OGB/OpenCode da maquina atual. E o comando simples
para rodar depois de atualizar uma maquina que deve receber o perfil global
limpo do OGB.

```bash
cd ~
ogb reset
ogb reset --dry-run
```

Contrato:

- so roda quando o projeto resolvido e o diretorio home (`cd ~` ou `--project "$HOME"`);
- mostra o plano e pede para digitar `RESET` antes de escrever;
- limpa artefatos antigos de projeto criados no home, com backup;
- recria o `opencode.json` global do perfil OGB, sem mesclar campos antigos;
- garante `OPENCODE_ENABLE_EXA=1`;
- reaplica comandos globais, agente YOLO, DCP, fallback e o plugin global OGB do OpenCode;
- roda sync global para injetar `GEMINI.expanded.md` em `instructions` e MCPs globais em `mcp`;
- roda doctor no final.

Flags:

```bash
ogb reset --yes
ogb reset --no-install-opencode
ogb reset --no-plugins
ogb reset --json
```

### `ogb check-update`

Consulta a ultima GitHub Release do OGB e grava
`.opencode/generated/ogb-update-status.json`.

```bash
ogb --project "$PWD" check-update
ogb --project "$PWD" check-update --json
```

### `ogb auto-update`

Compara a versao instalada com a ultima release e, se houver versao nova, roda
o mesmo bootstrap do `self-update`. Por padrao nao instala nem atualiza o
proprio OpenCode quando chamado automaticamente pelo plugin.

```bash
ogb --project "$PWD" auto-update
ogb --project "$PWD" auto-update --dry-run
ogb --project "$PWD" auto-update --install-opencode
```

Quando aplica update, grava `restartRequired: true` em
`.opencode/generated/ogb-update-status.json`; o plugin e a sidebar usam isso
para avisar que o OpenCode deve ser reiniciado.

### `ogb security-check`

Verifica riscos obvios:

```bash
ogb security-check
ogb security-check --strict
```

Checa secrets, guardrails do YOLO, env sensivel de MCP e se hooks/scripts de
extensoes ficaram apenas mapeados para revisao. Também falha se um hook/script
confiado mudou de hash.

### `ogb trust-extension`

Registra confiança seletiva em hook/script de extensão já revisado. Não executa
o hook.

```bash
ogb trust-extension medical-notes-workbench --hook hooks/hooks.json
ogb trust-extension medical-notes-workbench --script scripts/foo.mjs
ogb trust-extension medical-notes-workbench --all-hooks --dry-run
ogb trust-extension medical-notes-workbench --hook hooks/hooks.json --revoke
```

### `ogb adopt-agent-sync`

Gera um plano seguro para adotar `agent-rules-sync`.

```bash
ogb adopt-agent-sync
ogb adopt-agent-sync --json
```

Este comando nao instala daemon e nao muda arquivos de regras. Ele so lista
candidatos a sync, observacao ou exclusao.

### `ogb launch`

Prepara e abre OpenCode.

```bash
ogb launch
ogb launch --skip-sync
ogb launch --doctor strict
ogb launch --agent YOLO
ogb launch --yolo
```

Fluxo:

```text
inventory → flatten → sync → doctor → opencode [--agent <name>]
```

### Agente `yolo`

`ogb sync` e `ogb import` devem projetar o agente embutido:

```text
.opencode/agents/YOLO.md
```

Esse agente e o equivalente pratico do "YOLO mode" no fluxo OpenCode: as
permissoes declaradas do agente ficam em `allow`, incluindo `edit`, `bash`,
`task` e `external_directory`. Nao tornar essas permissoes globais.

`setup-ux` grava `default_agent: "YOLO"` no config global do OpenCode. Isso vale
fora de projetos OGB tambem, salvo quando o projeto aberto tiver um
`default_agent` local diferente.

O agente padrao pode ser escolhido no perfil OGB do projeto:

```jsonc
{
  "openCode": {
    "defaultAgent": "YOLO"
  }
}
```

`ogb sync` projeta esse valor para `default_agent` no `opencode.jsonc`.

### `ogb setup-ux`

Instala o perfil global de UX do OpenCode usado pelo OGB.

```bash
ogb setup-ux
ogb setup-ux --dry-run
ogb setup-ux --force
ogb setup-ux --reset-global
ogb setup-ux --no-install-opencode
ogb setup-ux --no-plugins
```

Deve:

- instalar OpenCode quando `opencode` não estiver disponível;
- gravar `~/.config/opencode/opencode.json` no macOS/Linux ou `%APPDATA%\opencode\opencode.json` no Windows;
- garantir `OPENCODE_ENABLE_EXA=1` para o websearch nativo do OpenCode: no Mac via `~/.config/zsh/.zshrc`, no Windows como variável de ambiente de usuário;
- instalar os plugins globais recomendados: auths, update notifier, auto-fallback, DCP, PTY e websearch citado;
- gravar comando global `/research` e remover o comando aposentado `/dev-server`;
- gravar comando global `/upgrade-ogb`;
- sobrescrever `~/.config/opencode/AGENTS.md` com o preset OGB;
- gravar config global de DCP e `plugins/fallback.json`;
- garantir `~/.config/opencode/package.json` com `type: "module"` e as
  dependências `@opentui/solid`/`solid-js` usadas pela TUI global;
- instalar `YOLO.md` como agente global OpenCode;
- definir o agente padrao global a partir de `openCode.defaultAgent` do perfil OGB;
- gravar `.opencode/ogb.config.jsonc` no projeto com as regras de fallback/subagente do OGB;
- não substituir `.opencode/ogb.config.jsonc` divergente sem `--force`.

Com `--reset-global`, o `opencode.json` global e recriado a partir do perfil OGB
em vez de mesclar campos antigos do usuario. O instalador usa esse modo quando
roda no home com `--force`.

Mental model: `setup-ux` replica a experiência OpenCode do OGB; `sync` recria
os recursos derivados do Gemini CLI local de cada pessoa.

### `ogb cleanup-home`

Remove artefatos de projeto que versões antigas possam ter criado por engano no
diretorio home.

```bash
ogb cleanup-home
ogb cleanup-home --dry-run
ogb cleanup-home --json
```

Deve:

- fazer backup em `~/.config/opencode-gemini-bridge/backups/home-cleanup/`;
- remover `~/opencode.jsonc` quando ele parecer config de projeto gerenciada
  pelo OGB;
- remover arquivos OGB conhecidos dentro de `~/.opencode`;
- remover arquivos listados no antigo `.opencode/generated/ogb-sync-state.json`
  quando a fonte for `ogb`;
- preservar arquivos alheios em `~/.opencode`, como `bin/` ou notas manuais.

### `ogb setup-opencode`

Instala o plugin local que roda sync quando OpenCode inicia.

```bash
ogb setup-opencode
ogb setup-opencode --dry-run
ogb setup-opencode --force
ogb setup-opencode --skip-doctor
```

Deve:

- criar `opencode.jsonc` se estiver ausente;
- copiar `.opencode/plugins/ogb-startup-sync.js`;
- gravar `.opencode/generated/ogb-startup-sync.json`;
- habilitar `ogb auto-update` antes do sync de startup;
- validar `node --check` do plugin;
- validar que o comando configurado consegue responder `--version`;
- registrar os arquivos no sync state;
- não sobrescrever plugin/config editados manualmente sem `--force`.
- gravar status do plugin em `.opencode/generated/ogb-plugin-status.json`;
- gravar status de update em `.opencode/generated/ogb-update-status.json`;
- atualizar `.opencode/generated/ogb-dashboard.md` depois do startup sync;
- mostrar toast de sucesso/falha/update aplicado quando a TUI do OpenCode estiver pronta.

O sync também instala a TUI:

```text
.opencode/tui-plugins/ogb-sidebar.js
.opencode/tui.jsonc
```

Essa TUI mostra `USAGE LIMITS`, `BRIDGE`, timer no footer e quota/reset do
provider atual.

### `ogb import`

Importação inicial suave.

```bash
ogb import
ogb import --dry-run
ogb import --rulesync require
ogb import --rulesync off
```

Fluxo:

```text
init opencode.jsonc
→ inventory
→ flatten
→ sync
→ doctor
```

Deve:

- criar `opencode.jsonc` sem sobrescrever configuração manual;
- gerar `.opencode/generated/GEMINI.expanded.md`;
- gerar `.opencode/generated/opencode.generated.json`;
- usar Rulesync em staging quando disponível;
- promover `.opencode/agents/*` e `.opencode/skills/*` com proteção por hash.
- gerar `.opencode/generated/ogb-extension-map.json`.

### `ogb install-extension`

Instala/projeta extensão Gemini.

Status: implementado no CLI.

Quando a fonte é Git e o objetivo é preservar auto-update, este comando deve preferir chamar `gemini extensions install` por baixo e depois rodar a projeção.

```bash
ogb install-extension ./minha-extensao --dry-run
ogb install-extension https://www.github.com/user/repo.git --ref=gemini-cli-extension --auto-update
ogb install-extension ./minha-extensao --trust
```

Deve:

- validar `gemini-extension.json`;
- preservar auto-update quando instalado por Git URL;
- avisar quando a extensão foi linkada/copiada localmente e não é auto-updatable;
- gerar projeção em staging;
- exigir `--trust` para hooks/scripts;
- registrar versão, hash e source map.

### `ogb update-extensions`

Atualiza extensões Gemini e reprojeta.

Status: implementado no CLI.

```bash
ogb update-extensions
ogb update-extensions --dry-run
```

Fluxo:

```text
gemini extensions update --all
→ inventory
→ sync --features extensions
→ doctor
```

Não deve atualizar extensões linkadas/local-copy como se fossem auto-updatable.

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

Quando `--project` aponta exatamente para o diretorio home (`~`), o CLI entra
em modo home. `init` e `setup-opencode` pulam a criacao de arquivos locais de
projeto para evitar `~/.opencode` e `~/opencode.jsonc`. `import` e `sync`
tratam a home como fonte global: regras, comandos, agents e skills do Gemini
passam por expansao/projecao para `~/.config/opencode/`. O estado gerado pelo OGB vai para
`~/.config/opencode-gemini-bridge/generated/`; o perfil OpenCode global tambem
continua em `~/.config/opencode/`.

Os instaladores seguem a mesma regra: quando recebem `--project ~`, rodam
`cleanup-home`, `setup-ux` e depois `import` global, mas nao instalam
`setup-opencode` nem criam arquivos de projeto no home.

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
