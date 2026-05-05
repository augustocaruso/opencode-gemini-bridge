# Project charter

## Nome

**OpenCode Gemini Bridge** (`ogb` como comando provisório).

## Propósito

Criar uma camada robusta para usar o **OpenCode como interface primária** para estudos e automação, preservando o sistema já existente no **Gemini CLI**.

O objetivo não é apenas migrar configs. O objetivo é preservar workflows, memórias, skills, agentes, MCPs, hooks e extensões, criando uma projeção confiável para o OpenCode.

## Usuário-alvo inicial

1. Usuário que já tem um sistema sólido no Gemini CLI.
2. Quer usar OpenCode como interface principal.
3. Usa a CLI principalmente para estudos e automação, não programação.
4. Precisa testar primeiro no Mac.
5. Depois quer replicar no Windows de outra pessoa com o mínimo de fricção.

## Escopo

Incluído:

- Inventário do setup Gemini.
- Flatten de `GEMINI.md` com imports `@file.md`.
- Geração de config OpenCode.
- Sincronização de skills, MCPs, subagentes e commands.
- Doctor/status de recursos carregados.
- Configuração de plugins OpenCode recomendados.
- Compatibilidade gradual com Gemini Extensions.
- Empacotamento e validação via GitHub Actions.
- Deploy no Mac e Windows.

Fora do escopo inicial:

- Reimplementar o Gemini CLI.
- Criar um provider LLM novo.
- Criar sync bidirecional completo entre Gemini e OpenCode.
- Reproduzir 100% da UI Gemini dentro do OpenCode.
- Migrar histórico completo de conversas.

## Critério de sucesso do MVP

O MVP é bem-sucedido quando:

1. `ogb inventory` lista recursos Gemini atuais.
2. `ogb flatten` gera `.opencode/generated/GEMINI.expanded.md` corretamente.
3. OpenCode lê o arquivo expandido como instrução principal.
4. Skills e agentes projetados aparecem no OpenCode.
5. `ogb doctor` detecta imports quebrados, recursos ausentes e status básico.
6. `ogb launch` abre o OpenCode com a projeção atualizada.

## Critério de sucesso final

O projeto completo é bem-sucedido quando:

- Extensões Gemini podem ser instaladas e projetadas no OpenCode.
- Sidebar/status/plugin mostra recursos carregados, limites e inconsistências.
- MCPs e agents são convertidos de forma previsível.
- Hooks/scripts só rodam depois de trust explícito.
- Sync bidirecional de regras existe com preview e backup.
- Setup roda no Mac e Windows com scripts de instalação claros.
- O usuário não perde memórias/regras/workflows do Gemini CLI.
