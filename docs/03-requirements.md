# Requirements

## Requisitos funcionais

### R1 — Inventário Gemini

O bridge deve detectar:

- `GEMINI.md` global e por projeto.
- Imports `@file.md` dentro de `GEMINI.md`.
- `.gemini/settings.json`.
- MCPs definidos em `mcpServers`.
- Skills em Gemini Extensions e caminhos Gemini legados.
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

O bridge deve projetar skills para `.opencode/skills/<name>/SKILL.md`.

Estratégias aceitas:

- Copiar skills de Gemini Extensions para `.opencode/skills`.
- Registrar origem/hash no sync state.
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
