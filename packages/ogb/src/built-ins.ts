export interface BuiltInTextFile {
  name: string;
  legacyNames?: string[];
  content: string;
}

export const BUILT_IN_AGENTS: BuiltInTextFile[] = [
  {
    name: "YOLO",
    legacyNames: ["yolo"],
    content: `---
description: Execucao direta com minima friccao em workspace confiavel.
mode: primary
color: "#ffb4b4"
permission:
  question: allow
  todowrite: allow
  edit: allow
  bash: allow
  task: allow
  external_directory: allow
---

Voce e o modo YOLO do OpenCode Gemini Bridge.

Use quando o usuario escolher este agente ou quando o perfil do projeto definir YOLO como default.

Comportamento:
- Execute direto quando o pedido estiver claro.
- Nao peca permissao para comandos normais de leitura, build, teste, git local ou edicao quando a intencao estiver clara.
- Explique antes de acoes destrutivas, irreversiveis, publicacao externa ou operacoes fora do workspace.
- Prefira comandos nao interativos.
- Quando delegar trabalho generico de engenharia, use o subagente YOLO-worker. Use subagentes especializados apenas quando o pedido exigir o contrato especifico deles.
- Ao final, resuma todas as mudancas.
`,
  },
  {
    name: "YOLO-worker",
    content: `---
description: Execucao delegada com minima friccao para tarefas genericas do YOLO.
mode: subagent
color: "#ffd0a6"
permission:
  read: allow
  edit: allow
  glob: allow
  grep: allow
  list: allow
  bash: allow
  task: allow
  external_directory: allow
  question: allow
  todowrite: allow
  webfetch: allow
  websearch: allow
  lsp: allow
  skill: allow
  doom_loop: ask
---

Voce e o worker delegado do modo YOLO do OpenCode Gemini Bridge.

Use este subagente para tarefas genericas de engenharia quando o agente YOLO principal quiser paralelizar ou isolar execucao sem perder a filosofia YOLO.

Comportamento:
- Execute direto quando o escopo delegado estiver claro.
- Nao peca permissao para comandos normais de leitura, build, teste, git local ou edicao dentro do workspace.
- Explique antes de acoes destrutivas, irreversiveis, publicacao externa ou operacoes fora do workspace.
- Prefira comandos nao interativos.
- Ao final, devolva um resumo objetivo do que mudou, dos arquivos tocados e da verificacao feita.
`,
  },
];

export const REMOVED_BUILT_IN_AGENT_NAMES = ["automation", "study", "review", "explore"];
export const REMOVED_BUILT_IN_COMMAND_NAMES = ["study", "automate", "review", "explore"];

export const BUILT_IN_COMMANDS: BuiltInTextFile[] = [
  {
    name: "bridge",
    content: `---
description: Painel principal do OpenCode Gemini Bridge
subtask: false
---

Primeiro rode pwd para confirmar o diretorio atual.

Depois execute exatamente:

ogb check --project "$PWD"

Use a saida desse comando como fonte principal. Se precisar ler o arquivo, leia apenas este caminho exato dentro do diretorio atual:

.opencode/generated/ogb-dashboard.md

Nao use glob, find ou busca recursiva na home do usuario. Se o painel mostrar que o projeto atual e a home e o usuario esperava outro projeto, explique que o OpenCode foi aberto na home e que ele deve abrir o OpenCode no diretorio do projeto ou rodar ogb check --project /caminho/do/projeto.

Explique em linguagem simples:
- se o bridge esta PASS, WARN ou FAIL;
- ultimo startup sync;
- MCPs, skills, agente YOLO e comandos carregados;
- extensoes Gemini projetadas;
- proximo passo concreto.

Nao edite arquivos.
`,
  },
  {
    name: "doctor",
    content: `---
description: Mostra diagnostico do OpenCode Gemini Bridge
subtask: false
---

Execute ou oriente a execucao de ogb doctor. Se o arquivo .opencode/generated/ogb-doctor.json existir, leia e resuma:

- contexto Gemini carregado;
- imports ausentes;
- skills;
- MCPs;
- agents/subagents;
- commands;
- warnings;
- proximos passos.

Nao edite arquivos.
`,
  },
  {
    name: "sync",
    content: `---
description: Sincroniza recursos Gemini para OpenCode
subtask: false
---

Execute ou oriente a execucao de ogb sync --dry-run primeiro. Depois peca confirmacao para rodar ogb sync real.

Explique quais arquivos serao gerados ou alterados.
`,
  },
  {
    name: "resources",
    content: `---
description: Lista recursos projetados pelo bridge
subtask: false
---

Leia .opencode/generated/ogb-dashboard.md, .opencode/generated/ogb-doctor.json e .opencode/generated/ogb-inventory.json quando existirem.

Resuma, em linguagem simples:
- MCPs ativos;
- skills disponiveis;
- agentes disponiveis;
- comandos disponiveis;
- extensoes Gemini detectadas;
- avisos que precisam de acao.

Nao edite arquivos.
`,
  },
  {
    name: "validate",
    content: `---
description: Valida o bridge de ponta a ponta sem chamar modelo por padrao
subtask: false
---

Execute ou oriente a execucao de ogb validate.

Use ogb validate --windows se o usuario estiver revisando instalacao Windows.
Nao use --opencode-run sem pedido explicito, porque isso pode gastar tokens.

Depois resuma:
- o que passou;
- avisos;
- falhas;
- proximo passo concreto.
`,
  },
  {
    name: "security-check",
    content: `---
description: Verifica riscos obvios de seguranca do bridge
subtask: false
---

Execute ou oriente a execucao de ogb security-check.

Explique em linguagem simples:
- se ha segredo/token materializado;
- se o YOLO manteve guardrails;
- se hooks de settings/extensoes foram sincronizados e scripts soltos ficaram apenas em revisao;
- o que precisa ser corrigido antes de distribuir.
`,
  },
  {
    name: "telemetry",
    content: `---
description: Mostra e envia telemetria local do OpenCode Gemini Bridge
subtask: false
---

Execute ogb telemetry status --project "$PWD" para ver se a telemetria local/remota esta ativa.

Se o mantenedor pedir para configurar recebimento por email, use:

ogb telemetry setup-email --project "$PWD"

Peça apenas o que faltar: email destino, remetente verificado no Resend e Resend API key. Nao imprima a API key. Se o Wrangler nao estiver logado, oriente npm exec --yes wrangler login e repita.

Se o usuario quiser revisar antes de enviar, execute:

ogb telemetry preview --since 7d --project "$PWD"

Se o usuario pedir envio manual, execute:

ogb telemetry send --since 7d --project "$PWD"

Esse envio normal manda remotamente apenas problemas acionaveis. Checks limpos continuam no preview/local. Use --include-pass somente se o mantenedor pedir explicitamente um teste/debug do canal remoto.

Se o usuario quiser desligar, execute:

ogb telemetry disable --project "$PWD"

Nunca mostre, peça para colar em chat, nem grave token de telemetria em arquivos do projeto. Para habilitar, use apenas endpoint/token fornecidos explicitamente pelo mantenedor ou por defaults privados empacotados.
`,
  },
  {
    name: "agent-sync",
    content: `---
description: Planeja adocao segura do agent-rules-sync
subtask: false
---

Execute ou oriente a execucao de ogb adopt-agent-sync.

Nao instale daemon nem habilite sync em background automaticamente.
Explique quais arquivos parecem bons candidatos a sync bidirecional e quais
devem ficar apenas observados porque sao gerados pelo ogb ou pertencem a
extensoes.
`,
  },
  {
    name: "status",
    content: `---
description: Resume o estado atual do bridge
subtask: false
---

Mostre um status curto do OpenCode Gemini Bridge.

Use ogb dashboard quando precisar atualizar o painel. Use ogb doctor se o dashboard apontar warning/fail. Depois responda:
- o que esta pronto;
- o que precisa atencao;
- qual e o proximo passo recomendado.
`,
  },
  {
    name: "update-extensions",
    content: `---
description: Atualiza Gemini Extensions e reprojeta OpenCode
subtask: false
---

Execute ou oriente a execucao de ogb update-extensions --dry-run primeiro.

Se o dry-run parecer seguro, rode ogb update-extensions --auto-consent.
Depois rode ou resuma ogb doctor.
`,
  },
  {
    name: "upgrade-ogb",
    content: `---
description: Atualiza o OpenCode Gemini Bridge pela release oficial
subtask: false
---

Execute exatamente:

ogb update --project "$PWD"

Depois execute:

ogb doctor --project "$PWD"

Explique em linguagem simples:
- versao anterior e nova, se aparecerem na saida;
- se o update reaplicou setup-ux/setup-opencode;
- se o doctor ficou limpo;
- se o OpenCode precisa ser reiniciado para carregar plugins, comandos ou agente default novos.
`,
  },
];
