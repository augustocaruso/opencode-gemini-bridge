# agent-rules-sync exploration

Última verificação: 2026-05-04.

## Resumo simples

`agent-rules-sync` é atraente porque combina com o futuro em que você edita regras ou skills em qualquer ferramenta e espera que o resto acompanhe.

Mas ele não deve ser ligado direto nas suas configs reais sem uma camada de segurança. O motivo principal é simples: ele reescreve arquivos inteiros em um formato próprio. Se o seu `~/.codex/AGENTS.md` tiver texto livre, ele pode virar apenas:

```markdown
# Shared Rules

## Codex Specific
```

Ele faz backup antes, mas para uma importação suave isso ainda é agressivo demais.

## O que ele faz bem

- Conhece os caminhos globais de Claude Code, Cursor, Gemini, OpenCode e Codex.
- Sincroniza `~/.codex/AGENTS.md` e `~/.config/opencode/AGENTS.md`.
- Sincroniza skills entre `~/.codex/skills`, `~/.config/opencode/skills`, `~/.agents/skills`, `~/.claude/skills` e outros caminhos.
- Tem modo daemon, modo `watch`, comando one-shot `sync`, backups e config de direção por componente.
- Para skills, copia o diretório inteiro, incluindo scripts, referências e assets.
- Usa só Python standard library.

## O que preocupa

- O instalador via `pip install agent-rules-sync` tenta instalar daemon persistente automaticamente.
- A versão publicada no PyPI em 2026-03-20 é `1.4.0`, mas o `main` do GitHub mostra `1.4.2`; precisamos escolher versão com cuidado.
- O `pyproject.toml` declara Python `>=3.8`, mas o código atual usa sintaxe que falha no Python 3.9 do macOS (`str | None`). Na prática, trate como Python 3.10+ até prova contrária.
- O parser de regras só preserva bullets dentro de `# Shared Rules` e seções `## <Agent> Specific`.
- Texto livre, parágrafos, headings diferentes e explicações ricas podem ser descartados na projeção.
- Para rules, ele não faz merge semântico de Markdown. Ele extrai linhas que começam com `-`, faz união/detecção de deleção e ordena.
- Para skills com mesmo nome, o critério principal é o `mtime` do `SKILL.md`; isso é simples, mas pode escolher errado quando duas ferramentas editam quase ao mesmo tempo.
- O comando `agent-sync sync rules`, no código atual, chama o sync principal, que também pode acionar skills/settings dependendo da config.

## Decisão recomendada

Não trocar o MVP inteiro para `agent-rules-sync` agora.

Usar o projeto como referência forte para a próxima fase:

```text
Fase A: importação segura
Gemini existente -> ogb import -> OpenCode/Codex funcionais

Fase B: sync diário controlado
ogb sync/doctor continua protegendo arquivos gerenciados

Fase C: sync bidirecional
ogb watch pode usar ideias ou código do agent-rules-sync,
mas com preview, backups, estado e política de conflito do ogb
```

Em outras palavras: `agent-rules-sync` vira candidato a motor do futuro, não substituto imediato da importação segura.

## Arquitetura sugerida

```text
                 editar em qualquer ferramenta
                           |
                           v
                  ogb sync state / doctor
                           |
        +------------------+------------------+
        |                                     |
        v                                     v
  rules simples                         skills inteiras
  AGENTS/CLAUDE/GEMINI                  SKILL.md + assets
        |                                     |
        v                                     v
 agent-rules-sync-like engine       newest/hash/conflict policy
        |
        v
 projeções para Codex, OpenCode, Gemini, Claude, Cursor
```

## Como integrar sem susto

### 1. Importação inicial

`ogb import` continua sendo o caminho de primeira vez.

Ele deve:

- Ler Gemini e configs existentes.
- Fazer backup.
- Mostrar preview.
- Gerar projeções OpenCode/Codex.
- Nunca iniciar daemon automaticamente.
- Nunca sobrescrever texto livre sem explicar o que vai mudar.

### 2. Preparação para sync bidirecional

Criar um comando:

```bash
ogb adopt-agent-sync
```

Ele mostraria:

- Quais arquivos seriam gerenciados.
- Quais arquivos têm texto livre incompatível com `agent-rules-sync`.
- Quais skills têm nomes duplicados.
- Qual seria a fonte inicial de cada recurso.

### 3. Sync diário

Depois da adoção:

```bash
ogb watch
```

ou:

```bash
ogb sync --bidirectional
```

O `ogb` deve continuar sendo a camada que decide:

- Pode escrever?
- Precisa backup?
- O arquivo foi editado manualmente?
- O conflito é automático ou precisa decisão humana?

## Papel de outras soluções open source

`agent-rules-sync`:
melhor referência para sync bidirecional real entre ferramentas. Bom candidato para fork, vendor parcial ou inspiração direta.

`Rulesync`:
melhor como conversor entre formatos e features. Continua útil para commands, MCPs, subagents e skills em staging.

`AGENTS.md`:
melhor formato comum para instruções humanas e instruções de projeto. Deve ser o idioma-base das regras sempre que possível.

`Agentlink`:
boa referência para o modelo "um arquivo real, vários links". É simples e previsível, mas estreito demais para nosso caso porque não resolve frontmatter, skills ricas, agentes, MCPs e diferenças de formato.

`chezmoi` ou GNU Stow:
bons para distribuir dotfiles entre máquinas. Não resolvem conflito semântico entre ferramentas de agente.

OpenCode plugins:
bons para uma fase posterior, especialmente status, avisos, comandos e ações dentro do OpenCode. Não devem ser o motor de sync.

## Próximo passo técnico

Antes de implementar daemon/watch real, criar um spike seguro:

```bash
ogb adopt-agent-sync --dry-run
```

Escopo do spike:

- Detectar arquivos globais de Codex, OpenCode, Gemini, Claude e Cursor.
- Classificar cada arquivo como `structured`, `freeform`, `missing` ou `unsafe`.
- Para `freeform`, propor uma conversão em Markdown preservando o texto.
- Para skills, detectar duplicatas por nome e hash.
- Não escrever nada por padrão.

Se esse spike ficar bom, aí sim implementamos o sync bidirecional.

Status atual: o spike seguro existe. Ele escreve somente o relatório
`.opencode/generated/ogb-agent-sync-adoption.json`, detecta se o executável
`agent-rules-sync` existe e classifica caminhos como `sync`, `observe` ou
`ignore`. Ele nao instala daemon e nao altera arquivos de regras.
