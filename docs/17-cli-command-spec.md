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

Tambem projeta os comandos OpenCode embutidos:

```text
/bridge
/doctor
/sync
/resources
/validate
/security-check
/agent-sync
/status
/update-extensions
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
- contagem de MCPs, skills, agentes, comandos e extensoes.

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
ogb --project "$PWD" self-update --release v0.0.30
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

### `ogb open`

Abre a TUI do OpenCode sem rodar sync/doctor antes.

```bash
ogb open
ogb open .
ogb open --agent YOLO
ogb open --yolo
```

Regra do agente:

```text
--agent/--yolo explicito -> default_agent do projeto -> openCode.defaultAgent do OGB -> YOLO
```

O comando sempre passa `--agent <nome>` para o OpenCode. Isso evita depender
apenas de `default_agent`, porque a TUI pode reabrir uma sessao antiga que foi
salva com outro agente.

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
inventory → flatten → sync → doctor → opencode --agent <resolved-agent>
```

### Agente `yolo`

`ogb sync` e `ogb import` devem projetar o agente embutido:

```text
.opencode/agents/YOLO.md
```

Esse agente e o equivalente pratico do "YOLO mode" no fluxo OpenCode: `edit` e `bash` ficam em `allow` quando o agente ativo e `YOLO`. Nao tornar essas permissoes globais.

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
ogb setup-ux --no-install-opencode
ogb setup-ux --no-plugins
```

Deve:

- instalar OpenCode quando `opencode` não estiver disponível;
- gravar `~/.config/opencode/opencode.json` no macOS/Linux ou `%APPDATA%\opencode\opencode.json` no Windows;
- instalar os plugins globais recomendados: auths, update notifier, auto-fallback, DCP, PTY e websearch citado;
- gravar comandos globais `/research` e `/dev-server`;
- gravar comando global `/upgrade-ogb`;
- gravar config global de DCP e `plugins/fallback.json`;
- instalar `YOLO.md` como agente global OpenCode;
- definir o agente padrao global a partir de `openCode.defaultAgent` do perfil OGB;
- instalar uma funcao de shell que faz `opencode` sem argumentos e `opencode <pasta>` abrir via `ogb open`, preservando subcomandos do OpenCode;
- gravar `.opencode/ogb.config.jsonc` no projeto com as regras de fallback/subagente do OGB;
- não substituir `.opencode/ogb.config.jsonc` divergente sem `--force`.

Mental model: `setup-ux` replica a experiência OpenCode do OGB; `sync` recria
os recursos derivados do Gemini CLI local de cada pessoa.

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
- validar `node --check` do plugin;
- validar que o comando configurado consegue responder `--version`;
- registrar os arquivos no sync state;
- não sobrescrever plugin/config editados manualmente sem `--force`.
- gravar status do plugin em `.opencode/generated/ogb-plugin-status.json`;
- atualizar `.opencode/generated/ogb-dashboard.md` depois do startup sync;
- mostrar toast de sucesso/falha quando a TUI do OpenCode estiver pronta.

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
