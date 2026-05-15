# Guia de configuração OpenCode

## Config global inicial

Arquivo:

```text
~/.config/opencode/opencode.jsonc
```

O perfil global recomendado é gerado pelo CLI em:

```text
packages/ogb/src/setup-ux.ts
```

Pontos importantes:

- `question: allow` para perguntas estruturadas.
- `todowrite: allow` para checklists.
- `YOLO` e `YOLO-worker` usam permissoes `allow`; o config global continua com bash mais conservador.
- `autoupdate: notify` para evitar updates silenciosos.
- `watcher.ignore` para evitar ruído.
- Plugins: Gemini auth e quota.

## Config de projeto

Arquivo:

```text
project/opencode.jsonc
```

O template de projeto é gerado pelo CLI em:

```text
packages/ogb/src/project-config.ts
```

O ponto crítico:

```jsonc
{
  "instructions": [
    ".opencode/generated/GEMINI.expanded.md"
  ]
}
```

## Agente gerado pelo bridge

- `YOLO`: execução com mínima fricção em ambiente confiável, escolhido explicitamente pelo usuário.
- `YOLO-worker`: subagente para delegacao generica do YOLO sem cair em subagentes especializados conservadores.

O agente embutido fica em:

```text
packages/ogb/src/built-ins.ts
```

OpenCode também aceita agentes Markdown em:

```text
.opencode/agents/
~/.config/opencode/agents/
```

O bridge canoniza outputs de conversores externos para esses caminhos.

## Commands recomendados

- `/bridge`
- `/doctor`
- `/sync`
- `/resources`
- `/status`
- `/validate`
- `/security-check`
- `/agent-sync`
- `/update-extensions`

Os comandos embutidos ficam em:

```text
packages/ogb/src/built-ins.ts
```

Skills devem preferir:

```text
.opencode/skills/<name>/SKILL.md
```

O caminho `.agents/skills/<name>/SKILL.md` continua útil como compatibilidade.

## Plugins recomendados

1. `@ex-machina/opencode-anthropic-auth`, se quiser Claude OAuth no OpenCode.
2. OpenUsage, se quiser tabela uniforme de limites OpenAI/Claude/Gemini.
3. Oh My OpenAgent/oh-my-opencode apenas como referencia de UX/arquitetura,
   nao como dependencia padrao do OGB.

O OGB já instala sua TUI própria para status/limits. Plugins de quota separados
podem servir de referência, mas não são mais a fonte principal da sidebar.

Depois:

4. `opencode-notify`
5. `opencode-websearch-cited`
6. `opencode-shell-strategy` ou instruções equivalentes.

## Modelo de permissões

Exemplo conservador para projetos que nao querem YOLO:

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

Depois criar `yolo` separado com `edit/bash: allow`. No perfil OGB, quando
`openCode.defaultAgent` e `YOLO`, subagentes projetados de extensoes tambem
recebem `bash: allow`; se o default mudar para outro agente, eles voltam a
`bash: ask`.

## Sobre YOLO

YOLO no OpenCode deve ser entendido como perfil de permissão, não necessariamente sandbox.

Para automação perigosa:

- Usar worktree.
- Usar repo descartável.
- Usar sandbox/container/devcontainer quando possível.
- No Windows, cuidado extra com comandos destrutivos.
