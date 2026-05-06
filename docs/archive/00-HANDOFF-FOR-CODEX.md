# Handoff para continuar no Codex

Cole este prompt no Codex depois de descompactar o pacote:

```text
Você está continuando o projeto OpenCode Gemini Bridge.

Objetivo: implementar uma camada robusta para usar OpenCode como interface primária para estudos e automação, preservando e sincronizando um setup existente do Gemini CLI.

Leia primeiro:
1. README.md
2. docs/01-cheat-sheet.md
3. docs/02-project-charter.md
4. docs/04-architecture.md
5. docs/08-mvp-roadmap.md
6. artifacts/README.md

Regras do projeto:
- Gemini CLI continua sendo a fonte inicial de verdade.
- GEMINI.md deve ser preservado como fonte de regras/memória.
- OpenCode consome uma projeção gerada, especialmente .opencode/generated/GEMINI.expanded.md.
- Não editar manualmente arquivos gerados.
- O foco é estudo e automação, não programação.
- O MVP deve ser testado primeiro no Mac; o deploy final será no Windows.
- Implementar incrementalmente: inventory → flatten → project config → skills → MCP sync → doctor → launch wrapper.

Tarefas iniciais sugeridas:
1. Verificar e corrigir os scripts em artifacts/scripts/.
2. Transformar artifacts/bridge-cli-skeleton em um CLI real chamado ogb.
3. Implementar ogb inventory para mapear recursos Gemini.
4. Implementar ogb flatten para expandir GEMINI.md e @imports.
5. Implementar ogb doctor para validar a projeção OpenCode.
6. Criar testes unitários para flatten, inventory e schema validation.
7. Só depois implementar sync de MCPs, subagentes, commands e extensões.

Ao fazer mudanças, mantenha a documentação sincronizada e adicione notas no CHANGELOG.md.
```

## Primeira pergunta útil para o Codex

```text
Leia a documentação do projeto e me devolva um plano de implementação do MVP em 5 passos, começando por ogb inventory e ogb flatten. Não escreva código ainda; apenas identifique lacunas, riscos e arquivos que devem ser alterados.
```
