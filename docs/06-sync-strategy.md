# Estratégia de sincronização

## Modelo escolhido para o bootstrap

```text
Gemini-first bootstrap, one-way projection
```

Isso significa:

```text
Gemini source → Bridge → OpenCode generated files
```

Gemini-first não precisa ser a estratégia permanente. Ele é a forma mais segura de sair do estado atual, porque o setup Gemini já existe. Depois da importação inicial, o projeto pode evoluir para sync bidirecional controlado.

## Por que não `.rulesync/` como fonte central?

Porque o setup Gemini existente já é sólido e o usuário considera `GEMINI.md` fonte de verdade inicial.

Rulesync continua útil como conversor auxiliar, mas não deve controlar a arquitetura principal.

## Caminho futuro: edit anywhere

Depois do MVP, a direção mais atraente é:

```text
Codex/OpenCode/Gemini/Claude/Cursor → camada ogb de segurança → todos os outros
```

`agent-rules-sync` é a referência mais forte para essa fase porque já sincroniza rules e skills entre várias ferramentas. O `ogb` deve explorar esse caminho sem abrir mão de:

- preview antes da adoção;
- backup;
- conflito explícito;
- hashes/source map;
- `doctor`;
- nenhum daemon automático sem confirmação.

## Sync bidirecional implementado

A primeira versão existe, mas é conservadora:

```bash
ogb bidirectional-sync --dry-run
ogb bidirectional-sync --force
ogb sync --bidirectional --dry-run
```

Ela sincroniza apenas regras Markdown de usuário:

```text
GEMINI.md / AGENTS.md de projeto
~/.gemini/GEMINI.md
~/.config/opencode/AGENTS.md
~/.codex/AGENTS.md
```

Política:

- escolhe o arquivo existente mais novo como fonte do grupo;
- cria alvos ausentes;
- se o alvo existe e difere, vira conflito;
- `--force` cria backup antes de atualizar;
- não instala daemon;
- não mexe em skills/assets/scripts nesta fase.

Ver também:

```text
docs/18-agent-rules-sync-exploration.md
adrs/ADR-007-agent-rules-sync-after-bootstrap.md
```

## Fluxo diário

```text
1. Editar GEMINI.md, skills, MCPs ou agents no ecossistema Gemini/source.
2. Rodar ogb sync ou ogb launch.
3. O bridge atualiza a projeção OpenCode.
4. OpenCode usa os arquivos gerados.
```

## Arquivos gerados

Exemplos:

```text
.opencode/generated/GEMINI.expanded.md
.opencode/generated/ogb-inventory.json
.opencode/generated/ogb-doctor.json
.opencode/agents/*.md
.opencode/commands/*.md
opencode.generated.jsonc ou blocos gerados em opencode.jsonc
```

## Idempotência

`ogb sync` deve ser idempotente:

- Mesma entrada → mesma saída.
- Ordenação determinística.
- Cabeçalhos com versão do gerador.
- Sem timestamps dentro de arquivos gerados, exceto quando explicitamente configurado.

## Dry-run

Todo comando com escrita deve aceitar:

```bash
ogb sync --dry-run
ogb flatten --dry-run
ogb install-extension X --dry-run
```

## Backups

Se o bridge precisar sobrescrever arquivo existente que não tem cabeçalho gerado, deve:

1. Falhar por padrão.
2. Oferecer `--backup`.
3. Oferecer `--force` apenas explicitamente.

## Tratamento de conflitos

Exemplos:

- Skill com mesmo nome em múltiplas extensões/projeções.
- MCP com mesmo nome no Gemini e OpenCode.
- Agent convertido já existe manualmente no OpenCode.
- Command com mesmo nome.

Estratégia:

```text
não sobrescrever recurso manual sem confirmação;
gerar warning;
registrar conflito no doctor;
permitir política futura: prefer-gemini, prefer-opencode, fail.
```

## Rulesync

Rulesync deve ser integrado como acelerador opcional, não como fonte de verdade.

Uso recomendado pelo bridge:

```bash
rulesync convert --from geminicli --to opencode --features mcp,commands,subagents,skills,permissions
```

O `ogb` não deve chamar esse comando diretamente no diretório do usuário sem proteção. O fluxo seguro é:

```text
1. Criar staging temporário.
2. Copiar apenas recursos Gemini necessários:
   GEMINI.md, .gemini/settings.json, agents, commands e skills.
3. Normalizar a cópia temporária quando o Rulesync exigir campos mais estritos.
4. Rodar Rulesync por feature, para uma falha em subagents não bloquear MCPs/skills.
5. Promover apenas outputs permitidos para caminhos canônicos OpenCode.
6. Registrar hashes em .opencode/generated/ogb-sync-state.json.
```

Caminhos canônicos de promoção:

```text
.opencode/agent/*  → .opencode/agents/*
.opencode/skill/*  → .opencode/skills/*
```

O bridge deve continuar tratando Rulesync como:

```text
motor auxiliar opcional
```

não como:

```text
única fonte de verdade
```

### Importação inicial

Comando recomendado:

```bash
ogb import --rulesync auto
```

Fluxo:

```text
init opencode.jsonc
→ inventory
→ flatten
→ sync nativo de contexto/MCP
→ Rulesync em staging para agents/skills/commands suportados
→ doctor
```

Se o usuário quiser falhar quando Rulesync não estiver disponível:

```bash
ogb import --rulesync require
```

### Sync diário

Comando recomendado:

```bash
ogb sync
```

Regras do sync normal:

- O sync é one-way: Gemini → OpenCode.
- Arquivos já promovidos pelo Rulesync podem ser atualizados se o hash atual bater com o último estado gerenciado.
- Arquivos editados manualmente viram conflito e não são sobrescritos sem `--force`.
- Use `ogb sync --dry-run` para pré-visualizar.
- Use `ogb doctor` para ver conflitos, recursos pendentes de revisão e status do último Rulesync.

Quando quiser sincronizar também regras livres entre ferramentas:

```bash
ogb sync --bidirectional --dry-run
ogb sync --bidirectional --force
```

## Não sincronizar automaticamente

Não migrar automaticamente:

- Histórico de conversas.
- Tokens/OAuth.
- Cookies.
- Chaves API.
- Estado interno de sessão.
- Memória externa sem consentimento.
