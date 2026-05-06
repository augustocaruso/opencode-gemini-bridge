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
2. [`ROADMAP.md`](ROADMAP.md) — mapa atual do produto e prioridades.
3. [`docs/01-cheat-sheet.md`](docs/01-cheat-sheet.md) — visão de bolso do projeto.
4. [`docs/02-project-charter.md`](docs/02-project-charter.md) — propósito, escopo e não-escopo.
5. [`docs/04-architecture.md`](docs/04-architecture.md) — arquitetura proposta.
6. [`docs/08-mvp-roadmap.md`](docs/08-mvp-roadmap.md) — roadmap historico do MVP.
7. [`docs/12-dia-a-dia.md`](docs/12-dia-a-dia.md) — fluxo curto de uso diario.
8. [`artifacts/README.md`](artifacts/README.md) — configs, scripts e templates incluídos.

## Princípios fixados

- **Gemini-first:** o `GEMINI.md` e recursos Gemini existentes continuam sendo a fonte inicial de verdade.
- **OpenCode-primary:** o OpenCode vira a interface principal de uso diário.
- **Projeção gerada:** arquivos OpenCode gerados não devem ser editados manualmente.
- **Sincronização confiável:** toda conversão deve ser reproduzível, validável e reversível.
- **Não programação primeiro:** o foco primário é estudo e automação; programação é um caso secundário.
- **Mac estável, Windows suportado com validação extra:** o instalador PowerShell replica o mesmo perfil, mas deve ser testado em um PC/VM Windows antes de mandar para muita gente.

## Workflow recomendado agora

Instalação local a partir deste checkout:

```bash
artifacts/scripts/install-mac.sh --project "$PWD"
```

No Windows, em PowerShell:

```powershell
.\artifacts\scripts\install-windows.ps1 -Project $PWD
```

Esses instaladores agora fazem três coisas: instalam o `ogb`, instalam o
OpenCode se ele ainda não existir e aplicam o perfil OGB do OpenCode
globalmente. Esse perfil inclui plugins, `/research`, `/dev-server`, DCP,
websearch, PTY, auto-fallback, YOLO, permissões conservadoras e a cadeia de
fallback dos subagentes. O conteúdo próprio do Gemini CLI de cada pessoa não é
copiado; ele é lido e projetado localmente pelo `ogb sync`.

Importação inicial:

```bash
cd artifacts/bridge-cli-skeleton
npm install
npm run build
node dist/cli.js --project /caminho/do/projeto setup-ux
node dist/cli.js --project /caminho/do/projeto import
node dist/cli.js --project /caminho/do/projeto setup-opencode
```

Distribuição por GitHub Release:

```bash
curl -fsSL https://raw.githubusercontent.com/augustocaruso/opencode-gemini-bridge/main/artifacts/scripts/bootstrap-mac.sh | bash -s -- --project "$PWD"
```

No Windows, pelo PowerShell:

```powershell
iwr -UseB https://github.com/augustocaruso/opencode-gemini-bridge/releases/latest/download/opencode-gemini-bridge-pack.zip -OutFile $env:TEMP\ogb.zip
Remove-Item -Recurse -Force $env:TEMP\ogb -ErrorAction SilentlyContinue
Expand-Archive -Force $env:TEMP\ogb.zip $env:TEMP\ogb
Set-ExecutionPolicy -Scope Process Bypass -Force
& $env:TEMP\ogb\install.ps1 -Project $PWD -Force
```

Update depois que o `ogb` ja esta instalado:

```bash
ogb --project "$PWD" self-update
ogb --project "$PWD" self-update --dry-run
ogb --project "$PWD" self-update --release v0.0.33
ogb --project "$PWD" check-update
ogb --project "$PWD" auto-update
```

O `self-update` baixa a release escolhida, roda o bootstrap oficial e reaplica
o perfil OGB/OpenCode. Ele nao copia secrets, sessoes ou conteudo unico do
Gemini CLI da pessoa; esse conteudo continua sendo lido localmente pelo sync.
O `auto-update` compara a versao local com a ultima GitHub Release, aplica a
release nova quando existir e grava `.opencode/generated/ogb-update-status.json`;
por padrao ele nao tenta instalar/atualizar o proprio OpenCode enquanto o
OpenCode ja esta aberto.

Dia a dia:

```bash
ogb sync
ogb doctor
ogb pass
ogb dashboard
opencode
opencode --agent YOLO
ogb launch --yolo
```

O Rulesync entra como auxiliar opcional no `ogb import` e no `ogb sync`: o bridge roda a conversão em staging temporário, promove apenas arquivos seguros/gerenciados e mantém `GEMINI.md` como fonte de verdade.

Use `ogb pass` quando quiser o caminho verde completo: ele roda setup local,
sync, doctor, validação, segurança e dashboard, e grava
`.opencode/generated/ogb-pass.json`. Se houver hooks Gemini revisados, rode
`ogb pass --accept-hooks`; isso registra o hash atual, sem executar hook, e o
doctor volta a avisar se o arquivo mudar depois.

O `setup-ux` tambem deixa o OpenCode global com `default_agent: "YOLO"` e
instala o agente YOLO globalmente, entao abrir `opencode` em uma pasta OGB sem
override local entra no YOLO. Se um projeto quiser outro padrao, defina
`openCode.defaultAgent` no perfil OGB dele.

O modo YOLO e instalado como agente separado do OpenCode:

```text
.opencode/agents/YOLO.md
```

Ele libera `edit` e `bash` quando o agente ativo e `YOLO`; as permissoes globais continuam conservadoras.

Para abrir diretamente no YOLO:

```bash
opencode --agent YOLO
ogb launch --yolo
```

Para deixar o YOLO como agente padrao do projeto distribuido pelo OGB:

```jsonc
{
  "openCode": {
    "defaultAgent": "YOLO"
  }
}
```

Esse bloco fica em `.opencode/ogb.config.jsonc`; o `ogb sync` traduz isso para
`default_agent` no `opencode.jsonc`.

O sync tambem instala comandos de uso diario dentro do OpenCode:

```text
/bridge
/doctor
/sync
/resources
/status
/validate
/security-check
/telemetry
/trust-extension
/update-extensions
/upgrade-ogb
```

Extensoes Gemini podem ser instaladas ou atualizadas pelo wrapper do bridge:

```bash
ogb install-extension https://github.com/usuario/extensao.git --ref gemini-cli-extension
ogb update-extensions
```

Comandos, skills, MCPs, `GEMINI.md` e subagentes das extensoes sao projetados
para OpenCode. Hooks e scripts continuam bloqueados por padrao: eles entram no
mapa de risco e so ganham um registro de confianca se voce rodar:

```bash
ogb trust-report medical-notes-workbench
ogb trust-extension medical-notes-workbench --hook hooks/hooks.json
ogb security-check
```

Esse comando nao executa hook. Ele registra o hash revisado. Se o hook/script
mudar depois, `ogb security-check` falha ate voce revisar de novo.

Fallback de modelo para subagentes e configuravel pelo usuario em:

```text
.opencode/ogb.config.jsonc
```

Exemplo:

```jsonc
{
  "modelFallbacks": {
    "agents": {
      "med-flashcard-maker": {
        "model": { "id": "openai/gpt-5.5", "variant": "xhigh" },
        "fallback_models": [
          { "model": "openai/gpt-5.4-mini", "variant": "medium" },
          { "model": "google/gemini-2.5-flash-lite", "effort": "low" }
        ]
      }
    }
  }
}
```

O OGB preserva o modelo importado da extensao como primeira escolha quando ele
existe. Se voce colocar `model`, esse modelo vira a primeira escolha sem editar
o subagente original. `variant`/`effort` aqui significam esforco de raciocinio;
o OGB traduz isso para `reasoningEffort` nos agentes OpenCode, registra a
decisao em `.opencode/generated/ogb-model-routing.json` e gera config opcional
para `opencode-auto-fallback`, que faz retry/cooldown quando a chamada falha em
runtime. O `doctor` e o `bridge` avisam se plugin, config ou modelo estiverem
faltando.

A hierarquia e simples:

- `agents.<nome>` ganha de tudo;
- `extensions.<nome-da-extensao>` vale para os subagentes daquela extensao;
- `allExtensionAgents` vale para todos os subagentes projetados.

Sync bidirecional seguro, primeira versao:

```bash
ogb bidirectional-sync --dry-run
ogb bidirectional-sync --force
```

ou junto do sync normal:

```bash
ogb sync --bidirectional --dry-run
```

Nesta fase ele sincroniza apenas regras Markdown de usuario entre Gemini,
OpenCode e Codex, com conflito por padrao e backup antes de sobrescrever.

Setup OpenCode com sync no startup:

```bash
ogb setup-opencode
```

Esse comando instala um plugin local em `.opencode/plugins/`, grava a configuração em `.opencode/generated/ogb-startup-sync.json`, valida o comando de startup e roda `doctor`. Quando o OpenCode inicia, o plugin roda `ogb auto-update`, aplica uma release nova do OGB se existir, avisa para reiniciar o OpenCode quando atualizar, roda `ogb sync`, grava `.opencode/generated/ogb-plugin-status.json` e `.opencode/generated/ogb-update-status.json`, registra telemetria local best-effort, atualiza `.opencode/generated/ogb-dashboard.md` e mostra toast de sucesso/falha quando a TUI permite. O caminho mais confiável ainda é abrir pelo wrapper:

```bash
ogb launch
```

Telemetria local-first:

```bash
ogb telemetry status
ogb telemetry setup-email
ogb telemetry preview --since 7d
ogb telemetry send --since 7d
ogb telemetry disable
```

Por padrao ela grava apenas registros locais redigidos em
`~/.config/opencode-gemini-bridge/telemetry/`. Envio remoto so acontece quando
voce configura `ogb telemetry enable --endpoint <url> --token <token>` ou
quando o pacote foi montado pelo mantenedor com defaults privados. `disable`
bloqueia esses defaults para aquela instalacao. O dashboard escreve
`.opencode/generated/ogb-telemetry-status.json`, sem token.

Para receber emails como no Medical Notes Workbench, rode
`ogb telemetry setup-email`. Ele usa o Wrangler logado na maquina, cria/sube um
Cloudflare Worker, coloca os secrets no Worker, configura Resend e grava um
`telemetry.defaults.json` privado dentro do pacote. Quando voce distribui esse
pacote privado, as instalacoes dos seus usuarios passam a enviar envelopes
redigidos para o seu Worker por padrao. Eles recebem apenas o endpoint e o token
de ingestao do Worker; a chave do Resend fica somente nos secrets da Cloudflare.

O arquivo `artifacts/bridge-cli-skeleton/telemetry.defaults.json` e ignorado
pelo Git para nao vazar o token, mas entra no pacote npm/tarball quando existe.
Use `ogb telemetry setup-email --no-distribution-defaults` se quiser configurar
so a sua maquina sem autoativar builds privados.

Para releases montadas pelo GitHub Actions, grave esse mesmo JSON no secret
`OGB_TELEMETRY_DEFAULTS_JSON`. O workflow restaura o arquivo antes de criar o
tarball/zip, sem mostrar o token nos logs.

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

O bridge ja e funcional, mas ainda esta em evolucao. Antes de distribuir para
terceiros, rode:

```bash
npm --prefix artifacts/bridge-cli-skeleton test
npm --prefix artifacts/bridge-cli-skeleton run build
ogb validate
ogb security-check
ogb bridge
```
