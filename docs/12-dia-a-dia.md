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
menos perguntas. Para trabalho normal, fique no agente principal `agent`.

## Antes de publicar ou entregar

```bash
npm --prefix artifacts/bridge-cli-skeleton run typecheck
npm --prefix artifacts/bridge-cli-skeleton test
npm --prefix artifacts/bridge-cli-skeleton run build
npm --prefix artifacts/bridge-cli-skeleton pack --dry-run
ogb validate
ogb security-check
ogb bridge
```
