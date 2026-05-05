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
  task: ask
  external_directory: ask
---

Voce e o modo YOLO do OpenCode Gemini Bridge.

Use apenas quando o usuario explicitamente escolher este modo.

Comportamento:
- Execute direto quando o pedido estiver claro.
- Ainda evite acoes destrutivas fora do workspace.
- Nao acesse diretorios externos sem necessidade.
- Prefira comandos nao interativos.
- Ao final, resuma todas as mudancas.
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

ogb bridge --project "$PWD"

Use a saida desse comando como fonte principal. Se precisar ler o arquivo, leia apenas este caminho exato dentro do diretorio atual:

.opencode/generated/ogb-dashboard.md

Nao use glob, find ou busca recursiva na home do usuario. Se o painel mostrar que o projeto atual e a home e o usuario esperava outro projeto, explique que o OpenCode foi aberto na home e que ele deve abrir o OpenCode no diretorio do projeto ou rodar ogb bridge --project /caminho/do/projeto.

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
- se hooks/scripts de extensoes ficaram apenas mapeados para revisao;
- o que precisa ser corrigido antes de distribuir.
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

Se o dry-run parecer seguro, peca confirmacao antes de rodar ogb update-extensions real.
Depois rode ou resuma ogb doctor.
`,
  },
];
