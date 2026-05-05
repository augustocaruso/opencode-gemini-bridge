# Uso diario

## Fluxo simples

Na maioria dos dias:

```bash
opencode
```

O plugin de startup tenta rodar `ogb sync` quando o OpenCode abre.

Quando quiser o caminho mais confiavel:

```bash
ogb launch
```

Esse caminho sincroniza antes de abrir o OpenCode.

## Depois de atualizar extensoes

```bash
ogb update-extensions
ogb sync
ogb bridge
```

Se algo parecer estranho:

```bash
ogb doctor
ogb validate
ogb security-check
```

## Antes de confiar em hooks/scripts

Hooks e scripts de Gemini Extensions ficam bloqueados por padrao.

Para registrar que voce revisou um hook:

```bash
ogb trust-extension nome-da-extensao --hook hooks/hooks.json
ogb security-check
```

Isso nao executa o hook. So grava o hash revisado.

## Sync bidirecional

Use primeiro preview:

```bash
ogb bidirectional-sync --dry-run
```

Se o relatorio estiver bom:

```bash
ogb bidirectional-sync --force
```

Nesta fase, isso sincroniza apenas arquivos de regras Markdown entre Gemini,
OpenCode e Codex. Nao sincroniza scripts, skills com assets ou hooks.

## Fallback de modelo em subagentes

Configure manualmente em:

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

Nao existe fallback padrao. Se voce nao configurar, o OGB nao inventa um.
`variant` e `effort` sao atalhos para esforco de raciocinio; o OGB grava isso
como `reasoningEffort` quando projeta o subagente do OpenCode.

Ordem de prioridade:

1. `agents.<nome>` para um subagente especifico.
2. `extensions.<nome-da-extensao>` para todos os subagentes de uma extensao.
3. `allExtensionAgents` para todos os subagentes projetados.

## O que olhar na UI

Sidebar:

```text
USAGE LIMITS
BRIDGE
MCP
LSP
```

Footer:

```text
⏱ 12s · OpenAI 4% used · reset 4h16
```

O rodape nao deve mostrar `$0.00`.
