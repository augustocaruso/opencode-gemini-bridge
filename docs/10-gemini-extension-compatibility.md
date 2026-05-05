# Compatibilidade com Gemini Extensions

## Objetivo

Permitir distribuir facilmente pacotes que hoje seriam Gemini Extensions, mas que também projetam recursos para OpenCode.

Em termos simples:

```text
Gemini Extension continua sendo o pacote oficial.
ogb aprende a instalar/ler esse pacote e gerar uma versão para Codex/OpenCode.
```

## Por que isso importa

Gemini Extensions podem empacotar:

- Prompts.
- MCP servers.
- Custom commands.
- Themes.
- Hooks.
- Sub-agents.
- Agent skills.
- Policy rules.
- Docs, scripts e assets auxiliares.

Isso é exatamente a unidade de distribuição desejada para estudos e automação.

Também é o ponto mais delicado da migração: se abandonarmos extensões cedo demais, perdemos auto-update, empacotamento, release por branch/tag e distribuição pela internet.

## Modelo mental da migração

Não desmontar a extensão em arquivos soltos.

A extensão vira a fonte empacotada. O bridge gera uma projeção:

```text
repo publicado / branch da extensão
        ↓
gemini extensions install/update
        ↓
~/.gemini/extensions/<name>
        ↓
ogb inventory / ogb sync
        ↓
.opencode/agents/
.opencode/commands/
.opencode/skills/
opencode.jsonc
.opencode/generated/ogb-extension-map.json
```

Isso mantém o benefício atual:

```text
publicar uma vez → usuários atualizam pela extensão Gemini → ogb reprojeta para OpenCode/Codex
```

## Onde cada coisa mora

### Fonte publicável

No repositório da extensão:

```text
gemini-cli-extension/
  gemini-extension.json
  GEMINI.md
  skills/
    <skill>/SKILL.md
  agents/
    <agent>.md
  commands/
    <command>.toml
  hooks/
    hooks.json
  scripts/
  docs/
  policies/
```

Essa pasta continua sendo publicada do jeito Gemini, idealmente em uma branch gerada como:

```text
gemini-cli-extension
```

### Instalação local Gemini

Depois do install/update:

```text
~/.gemini/extensions/<name>/
```

O `ogb` deve tratar essa pasta como instalação materializada da extensão.

### Projeção OpenCode/Codex

Arquivos gerados pelo bridge:

```text
.opencode/generated/ogb-extension-map.json
.opencode/commands/<path>/<command>.md
.opencode/agents/<agent>.md
.opencode/skills/<skill>/SKILL.md
```

## Estratégia

Criar um instalador:

```bash
ogb install-extension <path-or-git-url>
```

Esse instalador:

1. Instala ou localiza a extensão Gemini.
2. Lê `gemini-extension.json`.
3. Valida schema e caminhos.
4. Expande `GEMINI.md` e imports.
5. Inventaria skills, agents, commands, MCPs, hooks, scripts, docs e policies.
6. Gera projeção OpenCode em caminhos canônicos.
7. Promove apenas arquivos novos ou já gerenciados pelo `ogb`.
8. Registra hashes/source map em `.opencode/generated/ogb-sync-state.json`.
9. Roda doctor.

O instalador não deve ativar hooks/scripts automaticamente.
Agentes de Gemini Extensions são projetados como subagentes OpenCode, mas com
permissões conservadoras (`ask`) e rastreio no source map. O agente embutido do
bridge continua sendo apenas `YOLO`.

## Fluxos

### Primeira importação da máquina

```bash
ogb import --rulesync auto
ogb doctor
```

Esse fluxo descobre extensões já instaladas em:

```text
~/.gemini/extensions/
project/.gemini/extensions/
```

e marca cada extensão como `needs_review` até a projeção ser validada.

### Instalar uma extensão nova

Preferir instalar pelo próprio Gemini CLI quando a intenção é preservar auto-update:

```bash
gemini extensions install https://www.github.com/<owner>/<repo>.git --ref=<branch> --auto-update --consent
ogb sync
ogb doctor
```

Depois podemos oferecer um atalho:

```bash
ogb install-extension https://www.github.com/<owner>/<repo>.git --ref=<branch> --auto-update
```

Esse atalho deve chamar o fluxo Gemini quando possível, não reinventar o auto-update.

### Atualização diária

```bash
gemini extensions update --all
ogb sync
ogb doctor
```

ou, quando existir wrapper:

```bash
ogb update-extensions
ogb sync
ogb doctor
```

### Desenvolvimento local de uma extensão

```bash
gemini extensions link ./dist/gemini-cli-extension
ogb sync --dry-run
ogb sync
```

Nesse modo, o bridge deve deixar claro que a extensão linkada é desenvolvimento local, não instalação auto-updatable.

## Mapeamento

| Gemini Extension | OpenCode projection |
|---|---|
| `gemini-extension.json` | `.opencode/generated/ogb-extension-map.json` + MCP config quando houver |
| `GEMINI.md` / context | entra no contexto expandido e no source map |
| `skills/` | `.opencode/skills/<skill>/SKILL.md` |
| `agents/` | `.opencode/agents/<agent>.md` com permissões conservadoras |
| `commands/` | `.opencode/commands/<path>/<command>.md`; prefixa/renomeia só em colisão |
| `mcpServers` | `mcp` config |
| `hooks/hooks.json` | source map para revisao; nao executar automaticamente |
| `scripts/` | manter dentro da extensão; referenciar por caminho gerenciado |
| `docs/` | referências para skills, agents e generated context |
| `policies/` | OpenCode permissions/plugin guardrails, sempre com revisão |
| `settings[]` | avisos no doctor; não copiar secrets |
| `themes` | baixa prioridade |

## Namespacing

Extensões costumam ter comandos genéricos. A regra atual preserva o nome
natural quando possível e só prefixa/renomeia em colisão.

```text
commands/mednotes/create.toml → .opencode/commands/mednotes/create.md
commands/sync.toml            → .opencode/commands/sync-2.md se /sync ja existir
```

Quando há colisão real, o nome pode receber prefixo/índice:

```text
.opencode/commands/medical-notes-workbench/mednotes/create.md
.opencode/commands/mednotes/create-2.md
```

Skills podem manter o nome original quando não houver conflito. Se houver conflito:

```text
<extension>-<skill>
```

O doctor deve explicar esse rename.

Agentes projetados usam o nome do arquivo:

```text
agents/med-flashcard-maker.md → .opencode/agents/med-flashcard-maker.md
```

Se houver `model:` no frontmatter Gemini, ele é preservado. Fallbacks são
aplicados por `.opencode/ogb.config.jsonc`, sem editar o arquivo original da
extensão.

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

O OGB grava `.opencode/generated/ogb-model-routing.json` quando há fallback
configurado. No `ogb sync` ou no startup sync, ele consulta o cache de limites e
projeta o subagente com o primeiro modelo da cadeia que parece utilizável.

Para fallback em runtime, o OGB pode gerar config para `opencode-auto-fallback`.
Essa camada fica separada:

```text
OGB model routing          = decisao antes da chamada
opencode-auto-fallback     = retry/cooldown quando a chamada falha em runtime
```

Oh My OpenAgent/oh-my-opencode fica como referencia de UX e arquitetura, nao
como runtime padrao do OGB.

Para variantes de esforco, use `variant`, `effort` ou `reasoningEffort`. O OGB
grava `reasoningEffort` no agente projetado para o OpenCode. Assim `xhigh`,
`high`, `medium` ou `low` funcionam como esforco do modelo, nao como nome de
modelo separado.

## Auto-update

O auto-update pertence ao Gemini CLI.

O `ogb` deve observar a extensão instalada e reprojetar quando a versão ou hash mudar.

Estado mínimo a registrar:

```json
{
  "extension": "study-pack",
  "version": "0.3.1",
  "installedPath": "~/.gemini/extensions/study-pack",
  "manifestHash": "...",
  "projectionHash": "...",
  "source": {
    "type": "gemini-extension",
    "autoUpdate": true,
    "ref": "gemini-cli-extension"
  }
}
```

Se o usuário instalou por pasta local, o doctor deve avisar:

```text
Esta extensão parece não ser auto-updatable. Para auto-update, instale por Git URL + --ref + --auto-update.
```

## Regras de segurança

- Hooks não devem rodar automaticamente após instalação.
- Scripts devem ser marcados como trusted/untrusted por hash.
- Extensões de terceiros devem exigir `--trust` para ativar hooks/scripts.
- `ogb trust-report` deve listar hooks/scripts e os comandos detectados.
- Settings sensíveis da extensão não devem ser copiadas para `opencode.jsonc`.
- `mcpServers` devem usar caminhos portáveis, de preferência baseados no diretório da extensão.
- Policies que liberam permissões automaticamente não devem virar `allow` no OpenCode sem consentimento.

Fluxo safe/trusted:

```bash
ogb trust-report medical-notes-workbench
ogb trust-extension medical-notes-workbench --hook hooks/hooks.json
ogb security-check
```

O modo safe e o padrao: hooks/scripts ficam mapeados para revisao, mas nao sao
ativados silenciosamente. O modo trusted e seletivo: registra o hash de um hook
ou script revisado. Se o arquivo mudar, `ogb security-check` falha ate nova
revisao.

## Integração com sync bidirecional

Mesmo se o futuro for `edit anywhere`, extensões precisam de uma regra especial:

```text
Extensão instalada é pacote de distribuição.
Projeção OpenCode/Codex é saída gerada.
Mudança local em projeção não deve alterar a extensão publicada automaticamente.
```

Se o usuário editar uma projeção OpenCode gerada a partir de extensão:

1. `doctor`/`sync` marca conflito.
2. O usuário deve aplicar a mudança no repositório-fonte da extensão.
3. Depois disso, publica-se nova versão/branch da extensão.
4. `gemini extensions update` + `ogb sync` reprojeta.

Isso evita que um sync bidirecional destrua a disciplina de release.

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
- Validar bundle publicado, não só source.
- Validar que `hooks/hooks.json` referencia scripts existentes.
- Validar que subagents usam nomes de ferramentas MCP compatíveis com Gemini.
- Validar que nenhum secret aparece em manifest, docs ou projection.

## Resultado desejado

Instalação ideal:

```bash
gemini extensions install https://www.github.com/usuario/minha-extensao.git --ref=gemini-cli-extension --auto-update --consent
ogb sync
ogb launch
```

ou no Windows:

```powershell
gemini extensions install https://www.github.com/usuario/minha-extensao.git --ref=gemini-cli-extension --auto-update --consent
ogb sync
ogb launch
```

Atalho futuro:

```bash
ogb install-extension https://www.github.com/usuario/minha-extensao.git --ref=gemini-cli-extension --auto-update
ogb launch
```
