# Como usar no dia a dia

## Modelo mental

O Gemini continua sendo a fonte dos pacotes e das regras. O OGB projeta isso
para o OpenCode e gera relatorios para voce saber se esta tudo alinhado.

```text
Gemini Extension / GEMINI.md
        ↓
ogb sync
        ↓
OpenCode com contexto, comandos, skills, agentes, MCPs, quota e bridge
```

## Rotina curta

Antes de abrir uma sessao importante:

```bash
ogb sync
ogb bridge
opencode
```

Quando quiser um check mais completo:

```bash
ogb validate
ogb security-check
ogb bridge
```

## Abrir no home

Se o diretorio atual for exatamente o home (`~`), o OGB trata isso como uso
global, nao como projeto. Ele nao cria `~/.opencode`, nao cria
`~/opencode.jsonc` e nao escreve `.opencode/ogb.config.jsonc` na home.

Nesse caso, o OpenCode usa o perfil global em `~/.config/opencode/`. Os
relatorios do OGB que ainda fizerem sentido ficam em
`~/.config/opencode-gemini-bridge/generated/`.

`ogb sync` no home sincroniza como global: `~/.gemini/GEMINI.md`, `GEMINI.md`
das extensoes Gemini e imports viram
`~/.config/opencode-gemini-bridge/generated/GEMINI.expanded.md`, e esse conteúdo
expandido entra no contexto via `instructions` em
`~/.config/opencode/opencode.json`. O `setup-ux`/`reset` sobrescreve
`~/.config/opencode/AGENTS.md` com o preset OGB; o `sync` nao usa esse arquivo
como fonte canonica. Comandos, agents e skills do Gemini vao para
`~/.config/opencode/commands/`, `~/.config/opencode/agents/` e
`~/.config/opencode/skills/`. Recursos equivalentes dentro de extensoes Gemini
tambem sao projetados nesses diretorios globais. MCPs compativeis de
`~/.gemini/settings.json` e dos manifestos de extensoes entram no `mcp` global
do OpenCode.

Instalacoes novas rodam `ogb cleanup-home` antes de reaplicar o perfil global.
Esse comando faz backup em
`~/.config/opencode-gemini-bridge/backups/home-cleanup/` e remove apenas
artefatos OGB de projeto que ficaram na home por engano.

Quando o instalador recebe `--project ~`, ele tambem roda o sync global depois
do `setup-ux`, para deixar o expanded Gemini ja ligado no config global.

Para usar recursos de projeto, entre em uma pasta de projeto antes:

```bash
cd ~/Code/meu-projeto
ogb sync
opencode
```

## Quando atualizar extensoes

```bash
ogb update-extensions
ogb sync
ogb doctor
```

Se algo ficar estranho, rode:

```bash
ogb bridge
ogb trust-report
```

## Segurança de hooks/scripts

Por padrao, hooks e scripts de extensoes ficam apenas mapeados. Eles nao rodam
so porque a extensao existe.

Fluxo seguro:

```bash
ogb trust-report medical-notes-workbench
ogb trust-extension medical-notes-workbench --hook hooks/hooks.json
ogb security-check
```

Confiar em um hook registra o hash revisado. Se o arquivo mudar depois, o
`security-check` falha ate voce revisar de novo.

## Fallback de modelo

O OGB faz duas coisas diferentes:

```text
roteamento OGB           = decisao antes da chamada, no sync/startup
opencode-auto-fallback   = retry/cooldown se uma chamada falhar em runtime
```

Para conferir:

```bash
ogb doctor
ogb bridge
```

Procure as linhas `Runtime fallback` e `Model resolution`.

## Quando usar YOLO

Use `YOLO` apenas em workspace confiavel, quando voce quer execucao direta com
menos perguntas.

Para abrir direto no agente YOLO:

```bash
opencode --agent YOLO
ogb launch --yolo
```

Depois do `setup-ux`, o config global do OpenCode ja fica com
`default_agent: "YOLO"`, entao `opencode` abre no YOLO em pastas sem override
local diferente.

O instalador tambem garante `OPENCODE_ENABLE_EXA=1` para o websearch nativo do
OpenCode: no Mac em `~/.config/zsh/.zshrc`; no Windows como variável de
ambiente de usuário. Abra um terminal novo depois da instalação para herdar essa
variável.

Para resetar o perfil global depois de instalar ou atualizar o OGB, rode no
home:

```bash
cd ~
ogb reset
```

Esse comando so aceita home como projeto e pede para digitar `RESET` antes de
limpar artefatos antigos da home e sobrescrever o `opencode.json` global. Em
seguida, ele reinstala o plugin global OGB do OpenCode, roda sync global e
injeta de novo o `GEMINI.expanded.md`.

Para deixar o YOLO como padrao do projeto:

```jsonc
{
  "openCode": {
    "defaultAgent": "YOLO"
  }
}
```

Esse bloco vai em `.opencode/ogb.config.jsonc`; depois rode `ogb sync`.

## Atualizar OGB dentro do OpenCode

Use o comando:

```text
/upgrade-ogb
```

Ele roda `ogb self-update --project "$PWD"` e depois `ogb doctor --project
"$PWD"`.

## Antes de publicar ou entregar

```bash
npm --prefix packages/ogb run typecheck
npm --prefix packages/ogb test
npm --prefix packages/ogb run build
npm --prefix packages/ogb pack --dry-run
ogb validate
ogb security-check
ogb bridge
```
