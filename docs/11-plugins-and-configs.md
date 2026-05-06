# Plugins e configurações recomendadas

Ultima revalidacao: 2026-05-05.

## Estado local observado

Configuracao ativa hoje, sem instalar nada novo:

- global `~/.config/opencode/opencode.json`: `opencode-gemini-auth@1.4.12`,
  `@ex-machina/opencode-anthropic-auth@1.8.0`,
  `opencode-update-notifier@0.1.0`, `@tarquinen/opencode-dcp@3.1.9`,
  `opencode-pty@0.3.4`.
  `opencode-websearch-cited@1.2.0` foi observado no ambiente local antigo, mas
  nao faz mais parte do perfil distribuivel padrao porque registra auth hooks
  de OpenAI/Google apenas com API key e esconde OAuth desses providers.
  `opencode-auto-fallback@0.4.2` foi observado no ambiente local antigo, mas
  falha no OpenCode 1.14.39 com `Cannot find module '@/core/plugin'` e nao faz
  mais parte do perfil distribuivel padrao;
- global `~/.config/opencode/opencode.json`: `autoupdate: "notify"`,
  `share: "manual"`, `small_model: "openai/gpt-5.4-mini"`, `tool_output`
  compacto, compaction automatica com pruning, cauda recente preservada e
  buffer reservado;
- global `~/.config/opencode/opencode.json`: allowlist de `permission.bash`
  para comandos PTY/dev comuns e deny explicito para comandos destrutivos
  obvios;
- global `~/.config/opencode/dcp.jsonc`: DCP ativo, notificação mínima em toast,
  compressão em modo `range`, deduplicação e purge de erros ativos;
- global `~/.config/opencode/commands/`: comandos `/research` e `/dev-server`;
- projeto `~/opencode.jsonc`: contexto OGB, agente primario `agent`, `build`
  desabilitado, MCPs `anki-mcp` e `gemini-md-export`, sem plugins de projeto
  duplicando os globais;
- config resolvida por `opencode debug config`: plugins globais compativeis +
  startup sync local `file://~/.opencode/plugins/ogb-startup-sync.js`;
- TUI global `~/.config/opencode/tui.json`: mouse ligado, plugin vazio;
- TUI de projeto `~/.opencode/tui.jsonc`: sidebar OGB local em
  `./tui-plugins/ogb-sidebar.js`;
- runtime fallback gerado em `~/.config/opencode/plugins/fallback.json`, mas
  desabilitado no perfil padrao ate o plugin externo voltar a carregar limpo.

Observacao importante: a config atual nao define permissao global explicita para
`edit`/`bash`. Os subagentes medicos projetados usam `ask`, mas o agente
primario deve ser revisado separadamente se a experiencia desejada for sempre
perguntar antes de editar ou rodar shell.

## Perfil distribuivel do OGB

`ogb setup-ux` replica esse estado em outra maquina sem copiar dados pessoais.
Ele garante a instalacao/atualizacao do OpenCode, grava somente configuracoes,
plugins compativeis, comandos globais, DCP, YOLO e as politicas de
fallback/subagente. O conteudo unico do Gemini CLI de cada pessoa continua local
e entra no OpenCode pelo `ogb sync`.

Motivo: auth e plugins do OpenCode mudam rapido. Se a maquina ja tinha um
`opencode` antigo no `PATH`, pular a atualizacao podia deixar o usuario vendo
somente o fluxo de API key, mesmo com a config nova gravada.

Fluxo de onboarding:

- `ogb setup-ux` instala so os plugins seguros para abrir OAuth de OpenAI,
  Google/Gemini e Anthropic;
- se uma maquina antiga ja tinha `opencode-websearch-cited`, a proxima execucao
  remove o plugin da config global e limpa `provider.openai.options.websearch_cited`;
- a busca citada so deve voltar quando houver uma versao ou wrapper que nao
  registre auth hooks para `openai` e `google`.

O agente padrao tambem fica no perfil OGB:

```jsonc
{
  "openCode": {
    "defaultAgent": "YOLO"
  }
}
```

`ogb sync` projeta esse valor para `default_agent` no `opencode.jsonc`. Se a
pessoa preferir abrir no agente conservador, troque para `"agent"`.

O `setup-ux` tambem grava esse default no config global do OpenCode, para o
YOLO ser usado fora de projetos OGB. Um projeto ainda pode sobrescrever com seu
proprio `default_agent`.

Arquivos principais:

- macOS/Linux: `~/.config/opencode/opencode.json`;
- Windows: `%APPDATA%\opencode\opencode.json`;
- global: `commands/research.md`, `commands/dev-server.md`,
  `commands/upgrade-ogb.md`, `agents/YOLO.md`, `dcp.jsonc`,
  `plugins/fallback.json`;
- projeto: `.opencode/ogb.config.jsonc`.

## Plugins recomendados

### 1. `@ex-machina/opencode-anthropic-auth`

Uso:

- Autenticar Claude/Anthropic no OpenCode quando o provider precisar de OAuth.

Atenção:

- Verificar política e segurança do provider antes de usar em conta crítica.

### 2. `@slkiser/opencode-quota`

Uso:

- Referencia principal de layout/formatter para a quota compacta do OGB.
- Pode rodar servidor + TUI sem poluir contexto em modo experimental.
- Hoje o caminho padrao e manter a UI de quota no OGB, copiando a gramatica
  visual do plugin em vez de depender dele.

Licenca: MIT.

Config OGB:

```jsonc
{
  "externalPlugins": {
    "quotaUi": {
      "enabled": true,
      "suppressOgbLimits": true,
      "enableToast": false,
      "enabledProviders": ["openai", "anthropic", "google-gemini-cli"],
      "onlyCurrentModel": false,
      "percentDisplayMode": "used"
    }
  }
}
```

Quando habilitado em modo externo, `ogb sync`:

- adiciona `@slkiser/opencode-quota` ao `opencode.jsonc`;
- adiciona `@slkiser/opencode-quota` ao `.opencode/tui.jsonc`;
- grava `opencode-quota/quota-toast.json`;
- grava `.opencode/generated/ogb-ui.json` para a sidebar OGB esconder
  `Quota` e evitar dois paineis de quota ao mesmo tempo.

Estado recomendado atual:

```jsonc
{
  "externalPlugins": {
    "quotaUi": {
      "enabled": false
    }
  }
}
```

Nesse modo, o OGB usa sua propria fonte de quota e renderiza a sidebar com o
formatter compacto inspirado no plugin.

### 3. `opencode-auto-fallback`

Estado atual:

- Desabilitado no `ogb setup-ux` por incompatibilidade observada com OpenCode
  1.14.39: o plugin tenta importar `@/core/plugin` e falha durante o load.
- Pode voltar para o perfil padrao quando houver uma versao compativel validada.

Uso:

- Runtime fallback real: escuta erro/status da sessao, aplica retry/backoff,
  cooldown e troca para o proximo modelo.
- Complementa o roteamento do OGB. OGB escolhe antes da chamada quando sabe que
  um provider esta perto do limite; `opencode-auto-fallback` reage durante a
  chamada quando a API falha.

Licenca: MIT.

Config OGB:

```jsonc
{
  "externalPlugins": {
    "autoFallback": {
      "enabled": false,
      "cooldownMs": 60000,
      "maxRetries": 2,
      "logging": false
    }
  },
  "modelFallbacks": {
    "agents": {
      "helper": {
        "fallback_models": [
          "openai/gpt-5.4-mini",
          "anthropic/claude-haiku-4-5"
        ]
      }
    }
  }
}
```

Quando habilitado manualmente, `ogb sync`:

- adiciona `opencode-auto-fallback` ao `opencode.jsonc`;
- converte as cadeias `modelFallbacks.*.fallback_models` do OGB para
  `agentFallbacks`;
- grava `~/.config/opencode/plugins/fallback.json`, que e o caminho lido pelo
  plugin.

`ogb doctor` e `ogb bridge` tambem conferem essa camada:

- se `opencode-auto-fallback` esta ativo no `opencode.jsonc`;
- se o arquivo `fallback.json` existe e esta habilitado;
- quantas cadeias de fallback por agente foram geradas;
- se os modelos projetados aparecem em `opencode models`.

Mental model:

```text
OGB model routing          = decisao antes da chamada
opencode-auto-fallback     = reacao quando a chamada falha em runtime
```

### 4. Oh My OpenAgent / antigo oh-my-opencode

Uso:

- Referência de UX para fallback e diagnóstico de modelo.
- Não é dependencia padrao: o OGB usa seu proprio roteamento leve em
  `.opencode/generated/ogb-model-routing.json`.

### 5. OpenUsage

Uso:

- Fonte uniforme de limites OpenAI/Claude/Gemini para a TUI do OGB.
- Quando indisponível, o OGB tenta fallbacks nativos por provider.

Ordem recomendada:

```jsonc
{
  "plugin": [
    "@ex-machina/opencode-anthropic-auth"
  ]
}
```

O OGB já instala sua própria TUI (`.opencode/tui-plugins/ogb-sidebar.js`) para
`Quota`, `BRIDGE`, timer e quota/reset. Por padrão, a quota fica na TUI do OGB.
Se `quotaUi.enabled` estiver ligado, a TUI do OGB mantém `BRIDGE` e deixa a
quota para `@slkiser/opencode-quota`.

## Plugins úteis depois

### `opencode-update-notifier`

Valor:

- Bom encaixe para o OGB depois que os plugins forem pinados por versao.
- Avisa quando plugins npm pinados têm versao nova, sem atualizar sozinho.

Estado recomendado:

- [x] Primeiro trocar plugins flutuantes por versoes pinadas apos validar uma versao
  boa. Exemplo: `opencode-gemini-auth@1.4.12`,
  `@ex-machina/opencode-anthropic-auth@1.8.0`.
- [x] Instalar `opencode-update-notifier@0.1.0`.
- Testar visualmente o toast depois de reiniciar o OpenCode.

Risco:

- Baixo. Faz consulta ao npm e mostra toast, mas nao resolve o problema se os
  plugins continuarem como `@latest` ou sem versao.

### `@tarquinen/opencode-dcp`

Valor:

- Pode reduzir uso de contexto em sessoes longas, com compressao/pruning mais
  granular que a compaction nativa.
- Relevante para fluxos longos de wiki medica, triagem e revisao onde o chat
  acumula muito output de ferramenta.

Estado recomendado:

- Ativo globalmente em `@tarquinen/opencode-dcp@3.1.9`.
- Config atual: notificacao minima por toast, compressao `range`, compressao
  sugerida acima de 45% do contexto e mais forte perto de 80%.

Risco:

- Medio/alto. Mesmo quando preserva historico local, ele altera o que chega ao
  modelo. Licenca AGPL-3.0-or-later tambem exige cuidado se codigo/config for
  redistribuido.

### `opencode-tool-search`

Valor:

- Reduz tokens de descricoes de ferramentas ao adiar descricoes completas e
  expor uma busca de ferramentas.
- Pode ajudar se OGB crescer para muitos plugins/tools locais.

Estado recomendado:

- Nao usar agora. O README informa que MCP tools nao sao deferidas no OpenCode
  stock, e boa parte do peso do OGB vem justamente de MCPs/skills/projecoes.

Risco:

- Medio. Muda a forma como o modelo descobre ferramentas; pode piorar chamadas
  se o modelo ignorar a busca.

### `opencode-websearch-cited`

Valor:

- Pesquisa web com citacoes dentro do OpenCode.
- Util para estudos e verificacao rapida quando a resposta precisa de fontes.

Estado recomendado:

- Nao usar no perfil global do OGB com o OpenCode atual.
- Em `1.2.0`, o plugin exporta auth hooks para `openai` e `google` com metodo
  unico de API key. Como o OpenCode escolhe o ultimo auth hook registrado para
  cada provider, isso pode esconder `ChatGPT Pro/Plus` e `OAuth with Google
  (Gemini CLI)`.
- O comando `/research` do OGB continua existindo, mas usa a ferramenta de
  websearch disponivel no ambiente sem depender desse plugin.

Risco:

- Medio. Exige auth/model config especifica e pode interferir com fluxo de auth
  se carregado na hora errada.

### `opencode-models-discovery`

Valor:

- Descobre modelos dinamicamente em providers OpenAI-compatible e injeta modelos
  nao configurados.
- Pode ser util para gateways locais/remotos, LM Studio, Ollama, LocalAI ou
  providers com catalogo variavel.

Estado recomendado:

- Nao usar para substituir a validacao OGB contra `opencode models`.
- Considerar apenas se o problema passar a ser gateway OpenAI-compatible com
  catalogo grande/dinamico.

Risco:

- Medio. Pode aumentar ruido no seletor de modelos se filtros regex nao forem
  bem definidos.

### `opencode-vibeguard`

Valor:

- Redacao de segredos/PII antes da chamada ao modelo, com restauracao local.
- Pode ser interessante para contexto medico ou dados pessoais.

Estado recomendado:

- Avaliar com config pequena e exemplos artificiais primeiro.
- Nao ligar sobre a Wiki real sem confirmar que nao corrompe termos medicos,
  links, aliases ou caminhos.

Risco:

- Medio/alto. Qualquer redacao automatica pode atrapalhar conteudo clinico,
  YAML, links Obsidian e nomes de arquivo.

### `opencode-notify`

Notificações quando agente termina, pede permissão ou erro.

Estado observado:

- O pacote npm `opencode-notify` existe, mas a opcao mais documentada no
  ecossistema atual usa OCX (`kdco/notify`) e nao expõe flag simples
  `enabled=false`.
- O `opencode-notifier` citado em alguns lugares esta despublicado no npm.
- O app desktop do OpenCode ja pode notificar quando resposta fica pronta ou
  quando ha erro.

Estado recomendado:

- Adiar. Se a dor for notificacao, primeiro verificar as notificacoes nativas do
  desktop app.

### `opencode-shell-strategy`

Instruções para evitar comandos interativos travados.

Estado recomendado:

- Baixo risco como documento de instrucoes, mas provavelmente redundante com o
  comportamento que queremos no OGB/Codex.
- Melhor incorporar seletivamente ao `GEMINI.expanded.md`/AGENTS se aparecerem
  travamentos reais, em vez de adicionar mais um plugin.

### `opencode-background-agents`

Delegações longas em background.

Estado recomendado:

- Adicionar apenas depois do basico estar solido.
- Hoje compete com a visao futura do OGB para subagentes, fallback e auditoria.

### `opencode-skillful`

Lazy-loading de skills se houver muitas skills.

Estado recomendado:

- Aguardar. OGB hoje projeta poucas skills e OpenCode ja tem suporte nativo a
  skills. Reavaliar se o numero de skills crescer muito.

### `opencode-pty`

Processos interativos/background.

Estado recomendado:

- Ativo globalmente em `opencode-pty@0.3.4`.
- Bom para dev servers, watchers e REPLs. Use linguagem explicita como
  "rode como background session" para induzir o agente a chamar `pty_spawn`.

Risco:

- Alto. O proprio README observa que permissoes `ask` viram `deny` no plugin
  porque plugins nao conseguem abrir o prompt de permissao do OpenCode. Isso
  exige allow/deny bem pensado.

### `opencode-supermemory`

Memória persistente externa.

Estado recomendado:

- Nao usar no comeco para nao competir com `GEMINI.md`, OGB sync e memoria
  local.
- Exige API externa e uma politica clara sobre dados pessoais/medicos.

## Configuracoes nativas para testar

### Privacidade e atualizacoes

```jsonc
{
  "share": "disabled",
  "autoupdate": "notify"
}
```

- `share: "disabled"` evita compartilhamento acidental de sessoes. Se voce usa
  `/share`, manter `"manual"`.
- `autoupdate: "notify"` evita mudanca silenciosa quando a instalacao do
  OpenCode suporta esse modo. Em instalacoes por package manager, pode nao ter
  efeito.

### Permissoes do agente primario

Opcao conservadora para testar:

```jsonc
{
  "agent": {
    "agent": {
      "permission": {
        "question": "allow",
        "plan_enter": "allow",
        "edit": "ask",
        "bash": "ask",
        "external_directory": "ask"
      }
    }
  }
}
```

Valor:

- Reduz sustos no agente principal sem mexer nos subagentes ja projetados.

Trade-off:

- Mais prompts de permissao no dia a dia.

### Provider timeouts

Para tarefas longas com stream que as vezes trava:

```jsonc
{
  "provider": {
    "anthropic": {
      "options": {
        "timeout": 600000,
        "chunkTimeout": 30000
      }
    }
  }
}
```

Estado recomendado:

- Nao aplicar globalmente sem sintoma. Registrar como knob de troubleshooting.

### LSP e formatter

```jsonc
{
  "lsp": true,
  "formatter": true
}
```

Estado recomendado:

- `lsp`: testar em projeto de codigo isolado.
- `formatter`: nao ligar no workspace principal sem confirmar regras, porque
  formatadores podem reescrever arquivos automaticamente.

### Snapshots

Manter snapshots ligados. Desativar `snapshot` economiza indice/disco em
workspaces enormes, mas remove a possibilidade de reverter mudancas pela UI.

## Protocolo de avaliacao recomendado

Antes de promover qualquer plugin novo:

1. Criar `OPENCODE_CONFIG_DIR` temporario com config minima.
2. Pin de versao exata do plugin.
3. Rodar `opencode debug config` e confirmar a lista final de plugins.
4. Abrir uma sessao pequena, sem dados sensiveis.
5. Conferir se nao duplica UI do OGB, nao altera permissoes e nao injeta ruido
   no prompt.
6. So depois copiar para `~/.config/opencode` ou `~/opencode.jsonc`.

## Config base recomendada

Ver:

```text
artifacts/opencode/global-opencode.jsonc
```

## Princípio

Adicionar plugins em camadas:

```text
auth + OGB TUI → stable
quota externo + runtime fallback → melhores componentes especializados
pin/update-notifier → manutencao segura
dcp/websearch/pty → contexto, fontes e processos longos
supermemory/vibeguard/model-discovery/notify-extra → deliberar antes
```

Nao instalar plugins que mexem em memoria externa, redacao de dados ou catalogo
de modelos sem uma decisao explicita.
