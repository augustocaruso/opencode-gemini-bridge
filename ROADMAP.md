# OpenCode Gemini Bridge Roadmap

## Visao

Transformar o OpenCode na interface principal de trabalho sem perder o que ja
funciona bem no Gemini CLI: contexto, extensoes, skills, subagentes, MCPs,
comandos, quotas, sincronizacao e pequenas comodidades de UI.

Em termos simples:

```text
Gemini Extensions continuam sendo o pacote publicavel.
OGB le essas extensoes e projeta uma experiencia boa no OpenCode.
Com o tempo, o sync deixa de ser Gemini-first e vira tool-neutral.
```

## Estado atual

Ultima verificacao local: `ogb 0.0.22`, OpenCode `1.14.35`, dashboard
`PASS` na home local.

Ja existe uma base funcional:

- sync Gemini -> OpenCode;
- `GEMINI.md` das extensoes entrando no contexto expandido;
- MCPs projetados;
- skills projetadas;
- comandos Gemini projetados com nomes mais limpos;
- subagentes Gemini projetados como agentes OpenCode;
- fallback configuravel para subagentes projetados;
- roteamento OGB antes da chamada quando o cache de limites indicar provider
  acima do limite configurado;
- integracao opcional com `opencode-auto-fallback` para runtime fallback real
  com retry, cooldown e troca de modelo durante a sessao;
- `doctor` e `dashboard` mostram se o runtime fallback externo esta ativo,
  se a config existe e se os modelos roteados resolvem em `opencode models`;
- TUI de quota do OGB usando layout/formatter inspirado em
  `@slkiser/opencode-quota`, mantendo `Quota` e `BRIDGE` no mesmo painel;
- `@slkiser/opencode-quota` permanece como referencia e opcao experimental,
  nao como dependencia padrao da sidebar;
- comandos OpenCode: `/bridge`, `/doctor`, `/resources`, `/sync`,
  `/validate`, `/security-check`, `/update-extensions`;
- plugin de startup sync;
- plugin TUI com sidebar/footer;
- quotas OpenAI, Claude e Gemini com fallback quando OpenUsage nao esta
  disponivel;
- elapsed time discreto no footer;
- agente primario `agent` projetado pelo OGB;
- agente nativo `build` desabilitado via config oficial do OpenCode;
- agente `YOLO` com descricao curta e sem duplicar `YOLO YOLO`;
- Rulesync como conversor auxiliar;
- exploracao segura de `agent-rules-sync`;
- compaction configuravel e usando modelo mais economico.

Status atual em numeros no workspace principal:

```text
GEMINI.md files: 2
MCPs: 2
Skills: 10
Agents: 7
Commands: 21
Extension commands: 12
Startup sync: PASS
Usage limits: OpenAI ok, Claude ok, Gemini ok
```

## Sequencia imediata

Esta e a ordem recomendada a partir daqui:

1. Validar visualmente o OpenCode apos reiniciar: selector deve mostrar
   `agent`, `plan` e `YOLO`, sem `build native`.
2. Validar visualmente a quota na sidebar: todos os provedores/modelos,
   barra no sentido correto, percentual na mesma linha e sem wrap.
3. Testar o runtime fallback externo com falha simulada de provider/modelo.
4. Reiniciar OpenCode e confirmar visualmente o toast/sem ruido do
   `opencode-update-notifier`.
5. Deliberar os proximos plugins opcionais: vibeguard, model discovery,
   supermemory, notify extra e skillful.
6. Limpar comandos importados, aliases e documentacao de comandos.
7. Fortalecer `update-extensions` e remocao de recursos obsoletos.
8. Avancar sync bidirecional seguro alem do escopo rules-only.
9. Criar repositório GitHub e publicar a primeira release.
10. Validar instalador Windows em PC/VM real.

## Principios

- Nao desmontar extensoes Gemini em arquivos soltos sem rastreio.
- Nunca ativar hooks/scripts automaticamente sem revisao.
- Nao sobrescrever arquivo editado pelo usuario sem detectar conflito.
- Preferir preview, backup e estado gerenciado a automacao silenciosa.
- UI deve ser discreta, compacta e parecida com a gramatica visual do Gemini
  CLI.
- O usuario final nao deve precisar entender todos os detalhes internos para
  usar o bridge no dia a dia.

## Referencias externas

Estas referencias devem inspirar implementacoes, sem virar dependencia
obrigatoria antes de revisao:

- [Oh My OpenAgent](https://github.com/code-yeongyu/oh-my-openagent), antes
  conhecido como `oh-my-opencode`;
- [Oh My OpenAgent docs](https://ohmyopenagent.com/docs);
- [Oh My OpenAgent features reference](https://github.com/code-yeongyu/oh-my-openagent/blob/dev/docs/reference/features.md);
- [Oh My OpenAgent configuration reference](https://github.com/code-yeongyu/oh-my-openagent/blob/dev/docs/reference/configuration.md).

Partes especialmente relevantes:

- fallback configuravel de modelos por agente;
- cadeias de fallback com strings simples e objetos de configuracao;
- variante/esforco por modelo, projetado como `reasoningEffort` quando o
  provider/OpenCode espera esse nome;
- roteamento por categoria de tarefa;
- diagnostico de resolucao de modelo;
- agentes especializados com permissoes diferentes;
- execucao/background orchestration como referencia futura, nao como MVP.

## Prioridade 1 - Startup sync confiavel

Estado atual:

```text
Startup sync esta PASS no dashboard atual. Ainda precisamos cobrir melhor
casos de borda para nao voltar a aparecer STALE/RUNNING preso.
```

Objetivo:

```text
Abrir o OpenCode e confiar que o OGB carregou, sincronizou e registrou status
sem ficar preso em "running".
```

Tarefas:

- [x] limpar status `running` quando o processo morreu;
- [x] registrar inicio, fim, duracao e erro do startup sync;
- [x] fazer `ogb bridge` mostrar status de startup sync no dashboard;
- validar manualmente depois de reiniciar OpenCode;
- evitar duplicacao de comportamento entre plugin global e plugin de projeto;
- fazer `ogb bridge` explicar claramente quando o problema e so sessao antiga;
- decidir se `ogb launch` deve virar caminho recomendado;
- adicionar teste mais direto para status preso;
- garantir que reiniciar OpenCode resolva sem acao manual.

Resultado esperado:

```text
ogb bridge
Outcome: PASS
Startup sync: PASS
```

## Prioridade 2 - Fluxo completo de extensoes Gemini

Problema atual:

```text
O OGB ja le e projeta extensoes, mas o ciclo install/update/reproject ainda
precisa ficar redondo.
```

Objetivo:

```text
Usuario instala ou atualiza uma Gemini Extension e o OpenCode recebe a
projecao correta sem trabalho manual confuso.
```

Tarefas:

- fortalecer `ogb update-extensions`;
- detectar versao, hash e origem da extensao;
- reprojetar somente quando a extensao mudar;
- mostrar no dashboard quais extensoes foram atualizadas;
- manter comandos, skills, agentes e MCPs sincronizados;
- remover recursos antigos quando a extensao removeu algo;
- corrigir aliases/nomes de comandos importados para ficarem naturais no
  OpenCode;
- garantir que comandos antigos (`study`, `automate`, `review`, `explore`)
  nao voltem a poluir a lista quando foram gerados pelo OGB;
- documentar extensoes linkadas para desenvolvimento local;
- manter hooks/scripts apenas mapeados para revisao.

Resultado esperado:

```bash
ogb update-extensions
ogb sync
ogb bridge
```

sem surpresas, sem nomes antigos e sem lixo acumulado.

## Prioridade 3 - Limpeza de comandos, docs e contrato mental

Problema atual:

```text
Alguns documentos ainda refletem fases antigas do projeto.
```

Exemplo:

- docs antigos dizem que subagentes nao seriam projetados automaticamente;
- nomes antigos de comandos ainda aparecem na documentacao;
- o roadmap MVP esta desatualizado em relacao ao que ja foi implementado.

Objetivo:

```text
README, docs e comandos explicam exatamente o comportamento atual.
```

Tarefas:

- [x] atualizar `README.md`;
- [x] atualizar `docs/08-mvp-roadmap.md`;
- [x] atualizar `docs/09-plugin-and-sidebar-spec.md`;
- [x] atualizar `docs/10-gemini-extension-compatibility.md`;
- atualizar ADRs que ficaram obsoletas;
- [x] documentar os comandos finais projetados;
- [x] documentar quais agentes sao projetados;
- [x] documentar que o OGB projeta `agent` como agente principal e desabilita
  `build native`;
- [x] documentar o modo `YOLO` e quando usar;
- [x] explicar a diferenca entre comandos OGB e comandos vindos de extensoes;
- [x] criar uma pagina curta: "Como usar no dia a dia".

Resultado esperado:

```text
Um novo usuario entende o projeto sem ler a conversa inteira.
```

## Prioridade 4 - UI do OpenCode mais elegante

Problema atual:

```text
A sidebar/footer funcionam. A quota ja usa o layout compacto inspirado no
@slkiser/opencode-quota, mas ainda falta validacao visual em OpenCode real e
em larguras diferentes.
```

Objetivo:

```text
Replicar as melhores niceties do Gemini CLI no OpenCode sem poluir a tela.
```

Inspiracoes:

- Gemini CLI: discreto, compacto, pouca gritaria visual;
- `@slkiser/opencode-quota`: formatter compacto de sidebar, com label/reset na
  primeira linha e barra/percentual na segunda;
- opencode-limits-sidebar: tabela de limites clara;
- opencodeBar: elapsed time util, mas integrado de forma mais limpa.

Tarefas:

- [x] manter heading `Quota` e bloco `BRIDGE` no OGB;
- [x] copiar o layout/formatter de quota do plugin externo para a TUI do OGB;
- [x] manter barra e percentual na mesma linha com `wrapMode: "none"`;
- [x] mostrar OpenAI, Claude e Gemini na mesma lista quando houver dados;
- [x] remover `$0.00` do footer;
- [x] trocar `RUN` por `⏱` no footer;
- [x] resolver modelo selecionado via estado do OpenCode antes da primeira
  resposta;
- [x] substituir `build native` por `agent` no selector via config OpenCode;
- [x] encurtar descricao do `YOLO` para nao aparecer `YOLO YOLO`;
- validar visualmente no OpenCode apos reiniciar;
- [x] conferir em teste que a barra representa percentual usado, nao restante;
- conferir que nomes longos truncam sem quebrar a linha;
- testar em largura estreita e larga;
- validar visualmente quota antecipada ao selecionar modelo;
- [x] melhorar fallback OpenAI/Claude/Gemini;
- [x] usar OpenUsage under the hood quando disponivel;
- [x] decidir se a coleta/runtime de quota do `@slkiser/opencode-quota` deve virar
  fonte opcional, ou se ele continua apenas como referencia visual;
- [x] registrar matriz atualizada de plugins/configs candidatos;
- [x] pin de versoes de plugins npm ativos para reduzir atualizacao silenciosa;
- [x] instalar `opencode-update-notifier@0.1.0`;
- [x] instalar `opencode-websearch-cited@1.2.0` globalmente com OpenAI
  `gpt-5.5`;
- [x] instalar `@tarquinen/opencode-dcp@3.1.9` globalmente;
- [x] instalar `opencode-pty@0.3.4` globalmente;
- [x] mover `opencode-auto-fallback@0.4.2` para plugin global sem duplicar no
  `~/opencode.jsonc`;
- [x] criar comandos globais `/research` e `/dev-server`;
- [x] configurar `permission.bash` com allowlist para PTY/dev e deny para
  comandos destrutivos obvios;
- [x] configurar `tool_output` para preview menor de logs/terminal;
- [x] configurar compaction com `tail_turns`, `preserve_recent_tokens` e
  `reserved`;
- [x] configurar `share: "manual"` sem remover `/share`;
- validar visualmente `opencode-update-notifier` apos reiniciar OpenCode;
- deliberar `opencode-tool-search` se o numero de tools crescer;
- deliberar `opencode-vibeguard` apenas depois de avaliar exemplos artificiais
  antes de tocar em contexto medico real;
- nao reaproveitar quota de provider errado;
- manter elapsed time sem resetar no meio de uma tarefa;
- esconder ruido desnecessario do footer;
- revisar cores, case e espacamento;

Footer desejado:

```text
YOLO · GPT-5.5 · xhigh                         ⏱ 12s · OpenAI 4% used · reset 4h16
```

Sidebar desejada:

```text
Quota
OpenAI (Pro) Session       44m
████░░░░░░░░░░░░░░░░░░░░░░░░░░   13%
OpenAI (Pro) Weekly         6d
█░░░░░░░░░░░░░░░░░░░░░░░░░░░░░    3%
Claude Session           1h38m
██░░░░░░░░░░░░░░░░░░░░░░░░░░░░    6%
Claude Weekly               2d
███████░░░░░░░░░░░░░░░░░░░░░░░   23%
Gemini (Code Assist)    12h37m
█░░░░░░░░░░░░░░░░░░░░░░░░░░░░░    2%

BRIDGE
OGB PASS
sync pass 04:09 PM

2 GEMINI.md files · 2 MCP servers · 10 skills
```

Selector desejado:

```text
agent
plan
YOLO  Execucao direta com minima friccao em workspace confiavel.
```

## Prioridade 5 - Fallback configuravel de modelo para subagentes

Problema atual:

```text
Subagentes projetados das extensoes podem depender de um modelo implicito ou
ficar presos a um provider indisponivel/caro.
```

Complicador importante:

```text
O subagente vem importado da Gemini Extension. O modelo original pode estar
implícito no frontmatter, na extensao ou no comportamento do Gemini CLI. O OGB
nao deve editar o arquivo original so para resolver fallback do OpenCode.
```

Objetivo:

```text
Cada subagente pode ter uma cadeia de modelos fallback, para continuar
funcionando quando o modelo principal falhar, estiver sem quota, bater rate
limit, tiver auth indisponivel ou for caro demais para aquela tarefa.
```

Referencia principal:

```text
Oh My OpenAgent / antigo oh-my-opencode, como referencia de UX e arquitetura.
O runtime padrao deve ser leve e pertencer ao OGB.
```

Ideia a adaptar:

```jsonc
{
  "agents": {
    "med-flashcard-maker": {
      "model": { "id": "openai/gpt-5.5", "variant": "xhigh" },
      "fallback_models": [
        { "model": "openai/gpt-5.4-mini", "variant": "medium" },
        { "model": "google/gemini-2.5-flash-lite", "effort": "low" },
        { "model": "anthropic/claude-haiku-4-5", "reasoningEffort": "low" }
      ]
    }
  }
}
```

Tarefas:

- [x] estudar a implementacao de `fallback_models` do Oh My OpenAgent;
- [x] definir um schema OGB simples para fallback por subagente;
- [x] aceitar variante/esforco configuravel por modelo com `variant`, `effort`
  ou `reasoningEffort`;
- [x] tratar fallback como camada de projeção OpenCode, nao como edicao do agente
  Gemini original;
- [x] permitir fallback global para todos os subagentes projetados;
- [x] permitir override por extensao;
- [x] permitir override por agente;
- [x] preservar o modelo original importado como primeira escolha quando ele existir;
- [x] permitir que o usuario substitua a primeira escolha sem tocar no arquivo
  Gemini;
- [x] resolver modelos contra `opencode models` ou equivalente estavel;
- [x] avisar no doctor quando o roteamento OGB nao foi gerado;
- [x] registrar fallback aplicado em `.opencode/generated/ogb-extension-map.json`;
- [x] registrar decisao de roteamento em
  `.opencode/generated/ogb-model-routing.json`;
- [x] detectar quota alta pelo cache de limites e projetar o proximo modelo da
  cadeia antes da chamada;
- [x] gerar configuracao para `opencode-auto-fallback` quando habilitado;
- [x] instalar `opencode-auto-fallback` na config OpenCode quando habilitado;
- validar runtime fallback com falha simulada de provider/modelo;
- confirmar cooldown, max retries e modelo escolhido nos logs/artefatos;
- [x] detectar modelo indisponivel quando `opencode models` nao conhece um
  modelo roteado;
- detectar auth/provider indisponivel quando houver sinal confiavel do
  OpenCode ou do provider;
- nao fazer retry opaco no meio de uma tarefa; se trocar modelo, registrar o
  motivo e o modelo escolhido;
- [x] melhorar explicacao do fallback efetivo no `/bridge` e no `doctor`;
- [x] adicionar teste especifico para cadeia de 3 modelos nos agentes Medical Notes.

Cadeias atuais configuradas para Medical Notes:

```text
med-knowledge-architect:
Gemini 3.1 Pro high -> Claude Sonnet 4.6 high -> GPT-5.5 high

med-flashcard-maker:
Gemini 3.1 Pro high -> Claude Sonnet 4.6 high -> GPT-5.5 high

med-catalog-curator:
Gemini 3.1 Pro medium -> GPT-5.4 medium -> Claude Sonnet 4.6 medium

med-chat-triager:
Gemini 3 Flash high -> GPT-5.4 Mini medium -> Claude Haiku 4.5 high

med-publish-guard:
Gemini 3 Flash high -> GPT-5.4 Mini medium -> Claude Haiku 4.5 high
```

Resultado esperado:

```text
No sync/startup, OGB le limites e configuracao.
Se o provider principal estiver acima do limite configurado, projeta o
subagente com o proximo modelo da cadeia.
Doctor/dashboard mostram a decisao efetiva de roteamento.
```

Modelo mental:

```text
Gemini Extension original
        ↓
agente importado com model original
        ↓
camada OGB aplica policy/fallback OpenCode
        ↓
.opencode/agents/<agent>.md gerado
```

## Prioridade 6 - Sync bidirecional seguro

Problema atual:

```text
O fluxo ainda e principalmente Gemini -> OpenCode.
```

Objetivo:

```text
Permitir editar regras/skills em Gemini, OpenCode, Codex, Claude ou Cursor e
sincronizar sem destruir texto livre ou assets.
```

Base explorada:

- `agent-rules-sync` e uma boa referencia;
- ele ja conhece caminhos globais de varias ferramentas;
- mas e agressivo demais para ligar direto sem camada de seguranca.

Tarefas:

- [x] criar base de `ogb adopt-agent-sync`;
- evoluir `ogb adopt-agent-sync`;
- classificar arquivos como `structured`, `freeform`, `missing`, `unsafe`;
- detectar skills duplicadas por nome/hash;
- propor fonte inicial de verdade para cada recurso;
- criar preview de mudancas;
- criar backups antes de qualquer escrita;
- implementar politica de conflito;
- implementar `ogb sync --bidirectional`;
- avaliar `ogb watch`;
- nunca instalar daemon automaticamente;
- nunca apagar texto livre sem confirmacao.

Resultado esperado:

```bash
ogb adopt-agent-sync --dry-run
ogb sync --bidirectional --dry-run
ogb sync --bidirectional
```

com relatorio claro do que mudou e por que mudou.

## Prioridade 7 - Segurança e trust de hooks/scripts

Problema atual:

```text
Gemini Extensions podem carregar hooks e scripts poderosos. Hoje o OGB mapeia,
mas nao ativa automaticamente.
```

Isso esta correto, mas falta uma UX melhor.

Objetivo:

```text
Permitir confiar seletivamente em partes de uma extensao.
```

Tarefas:

- [x] mapear hooks/scripts por extensao no inventario/dashboard;
- [x] criar relatorio detalhado de hooks/scripts por extensao;
- [x] mostrar comandos que cada hook pode executar;
- [x] criar base de trust com hash e `security-check`;
- [x] criar UX final de `ogb trust-extension <name>` com escopo limitado;
- [x] permitir confiar somente em um hook especifico;
- [x] manter scripts dentro da extensao, sem copiar cegamente;
- [x] registrar decisoes de trust em arquivo gerenciado;
- [x] `security-check` deve falhar quando hook confiado muda de hash;
- [x] documentar modo seguro e modo trusted.

Resultado esperado:

```bash
ogb security-check
ogb trust-extension medical-notes-workbench --hook mednotes
ogb sync
```

sem ativacao silenciosa.

## Prioridade 8 - Instalador final de usuario

Problema atual:

```text
A instalacao funciona para desenvolvimento, mas ainda nao parece produto final.
```

Objetivo:

```text
Instalar OGB de forma seamless em uma maquina nova.
```

Tarefas:

- [x] instalador Mac funcional para desenvolvimento;
- [x] validar comando global `ogb`;
- [x] validar no `ogb validate` que o binario global responde com a versao
  esperada;
- [x] instalar ou atualizar dependencias;
- [x] registrar plugin OpenCode;
- [x] registrar plugin TUI;
- [x] rodar `setup-opencode`;
- [x] rodar `sync`, `validate`, `security-check`, `bridge`;
- [x] gerar diagnostico final simples;
- [x] aplicar perfil global OpenCode com `ogb setup-ux`;
- [x] instalar OpenCode automaticamente quando ausente;
- [x] preparar bootstrap por GitHub Release;
- [x] preparar instalador Windows equivalente;
- tornar mensagens do instalador mais amigaveis para usuario final;
- criar `uninstall`;
- criar `upgrade`;
- publicar release em um repositorio GitHub real;
- validar Windows em ambiente real.

Resultado esperado:

```bash
curl ... | bash
ogb bridge
```

e o usuario ver `PASS` sem precisar ajustar detalhes.

## Prioridade 9 - Compaction e memoria de continuidade

Estado atual:

```text
OpenCode tem compaction automatica e o agente interno pode usar modelo barato.
```

Objetivo:

```text
Garantir que compactacoes nao percam decisoes importantes do bridge.
```

Tarefas:

- [x] configurar compaction com modelo economico;
- documentar config recomendada de compaction;
- criar hook OGB de compaction, se a API permitir;
- injetar resumo persistente antes da compaction;
- preservar decisoes, caminhos, comandos, extensoes e estado do bridge;
- preservar preferencia do usuario por linguagem simples;
- testar sessoes longas.

Config recomendada:

```jsonc
{
  "compaction": {
    "auto": true,
    "prune": true
  },
  "agent": {
    "compaction": {
      "model": "openai/gpt-5.4-mini"
    }
  }
}
```

## Prioridade 10 - Testes e CI

Objetivo:

```text
Evitar regressao no bridge enquanto a UI e sync ficam mais ambiciosos.
```

Tarefas:

- [x] GitHub Actions;
- testes Mac;
- testes Windows quando houver instalador;
- fixtures de extensoes Gemini;
- testes de comandos aninhados;
- testes de subagentes;
- testes de remocao de recursos obsoletos;
- testes de startup sync stale;
- [x] testes de quota por provider;
- smoke test de instalador;
- [x] teste de snapshot textual do formatter de quota da sidebar;
- [x] teste para impedir barra de quota invertida;
- [x] teste para garantir `wrapMode: "none"` nas linhas de quota;
- [x] teste/smoke para validar que o `ogb` global aponta para a versao esperada;
- teste manual documentado de runtime fallback externo;
- teste do agente `agent` substituindo `build native`;
- teste da descricao curta do `YOLO`;

Checks minimos:

```bash
npm run typecheck
npm test
npm run build
node --check dist/tui-sidebar.js
npm pack --dry-run
ogb validate
ogb bridge
```

## Fluxo diario desejado

Para o usuario:

```bash
opencode
```

ou, no caminho mais confiavel:

```bash
ogb launch
```

Nos bastidores:

```text
update extensoes quando pedido
sync
validate leve
dashboard
OpenCode com sidebar/footer atualizados
```

## Definicao de pronto

O projeto chega na visao original quando:

- abrir OpenCode ja carrega contexto, MCPs, skills, comandos e agentes;
- extensoes Gemini continuam sendo a unidade de distribuicao;
- updates de extensao reprojetam OpenCode sem trabalho manual;
- sidebar/footer mostram quota, modelo, timer e bridge sem ruido;
- hooks/scripts so rodam quando confiados explicitamente;
- sync bidirecional existe com preview e backup;
- instalador funciona em maquina limpa;
- docs explicam o fluxo sem depender da conversa original.
