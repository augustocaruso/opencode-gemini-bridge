# Changelog

## 0.0.49 - Windows startup plugin process runner

- Faz o plugin de startup sync usar `cmd /c call` no Windows para executar shims `.cmd` como `ogb.cmd`, evitando falha instantanea com `exit code null`.
- Registra signal/erro quando o processo filho termina sem exit code numerico, deixando o diagnostico do startup sync mais claro.
- Faz `ogb reset` limpar status antigos de update, validation e security para o dashboard nao continuar vermelho por relatórios obsoletos.

## 0.0.48 - Windows npm warning tolerance

- Faz o instalador Windows capturar stdout/stderr de comandos nativos sem deixar warnings do `npm.cmd` virarem erro fatal no PowerShell.
- Mantem a decisao de falha baseada no exit code real do processo, para `npm install` poder concluir mesmo quando dependencias emitem avisos de deprecacao.

## 0.0.47 - Windows reset cleanup and command runner

- Corrige o runner Windows para executar `.cmd` via `cmd /c call` sem aspas escapadas como texto literal, e executa `.exe` diretamente.
- Faz `ogb reset` limpar diretorios antigos de projeto em `~/.opencode`, incluindo skills duplicadas que conflitam com o perfil global.
- Limpa status antigo de startup sync durante reset, para falhas de instalacoes anteriores nao continuarem aparecendo depois de um reset bem-sucedido.
- Ajusta doctor/dashboard no modo home para mostrar a config global como o config esperado, em vez de reportar `missing config` de projeto.

## 0.0.46 - Windows self-update bootstrap fix

- Faz o instalador Windows chamar `npm.cmd` explicitamente, evitando que warnings do `npm.ps1` no PowerShell sejam tratados como erro fatal.
- Desliga a promocao de erro nativo do PowerShell 7 durante bootstrap/install, mantendo a falha real pelo exit code.
- Para de apagar `~/ogb.cmd` enquanto ele pode estar executando; shims antigos no home agora sao reparados para apontar ao CLI estavel.

## 0.0.45 - global profile reset and TUI hardening

- Move o pacote CLI de `artifacts/bridge-cli-skeleton` para `packages/ogb`.
- Move instaladores e bootstraps para `scripts/`.
- Arquiva handoffs e docs antigas de MVP em `docs/archive/`.
- Remove templates/workflows duplicados e mantém o Worker de telemetria dentro do pacote CLI.
- Faz `ogb reset` e `setup-ux --reset-global` tratarem a home como perfil global, limpando artefatos antigos e sobrescrevendo as configuracoes globais gerenciadas.
- Registra o plugin global do OGB no `opencode.json`, corrige o lock global do startup sync e evita status `running` preso.
- Gera `GEMINI.expanded.md` global a partir dos `GEMINI.md` das extensoes Gemini e injeta esse contexto por `instructions`, sem mexer no `AGENTS.md` durante o sync.
- Importa MCPs globais do Gemini CLI e das extensoes para o OpenCode global.
- Remove o comando `/dev-server` do perfil inicial e instala apenas os comandos globais que continuam fazendo sentido.
- Instala as dependencias globais da TUI quando necessario, para o plugin visual carregar no OpenCode.
- Distribui um `AGENTS.md` global inicial do OGB e configura o agente YOLO com todas as permissoes em `allow`.

## 0.0.34 - Windows installer repair

- Instala o CLI em uma pasta estável local e registra `ogb.cmd` apontando direto para `dist/cli.js`, evitando shim quebrado sem `node_modules`.
- Remove instalações quebradas em `C:\Users\<user>\-Force` e shims antigos antes de registrar o novo comando.
- Atualiza a validação estática do instalador Windows para cobrir o novo fluxo.

## 0.0.28 - global YOLO and updater command

- Garante que `setup-ux` instale o comando global `/upgrade-ogb` dentro do OpenCode.
- Documenta que `setup-ux` define `default_agent: "YOLO"` no config global do OpenCode, valendo fora de projetos OGB quando nao houver override local.
- Projeta `/upgrade-ogb` tambem como comando gerenciado do projeto.

## 0.0.27 - default agent profile

- Adiciona `openCode.defaultAgent` ao perfil OGB para escolher o agente padrao projetado em `opencode.jsonc`.
- Define o perfil distribuivel do OGB para abrir com `YOLO` por padrao, mantendo permissoes globais conservadoras.
- Adiciona `ogb launch --agent <name>` e o atalho `ogb launch --yolo`.

## 0.0.26 - restore quota refresh

- Restaura a coleta de quota Anthropic e Gemini quando os access tokens do OpenCode expiraram.
- Reusa os plugins globais de auth instalados pelo `setup-ux` para descobrir dados OAuth publicos, sem embutir segredos no repo.
- Mantem Anthropic e Gemini visiveis na sidebar; se falharem, o problema real continua aparecendo em vez de ser escondido.

## Unreleased - external quota UI and runtime fallback

- Adiciona `externalPlugins.quotaUi` para carregar `@slkiser/opencode-quota` no servidor/TUI e esconder o bloco `USAGE LIMITS` do OGB quando a UI externa estiver ativa.
- Adiciona `externalPlugins.autoFallback` para carregar `opencode-auto-fallback` e gerar `~/.config/opencode/plugins/fallback.json` a partir das cadeias `modelFallbacks`.
- Mantem o OGB como orquestrador: roteamento antes da chamada fica no OGB; retry/cooldown/troca durante erro de sessao fica no plugin externo.
- Atualiza `ogb sync`, `ogb setup-opencode`, `opencode.jsonc` e `.opencode/tui.jsonc` para projetar os plugins externos de forma opcional e testada.
- Copia a gramatica visual compacta do plugin de quota para a sidebar nativa do OGB, usando barras de percentual usado e mantendo os dados do OGB como fonte.

## 0.0.25 - self-update and release hardening

- Adiciona `ogb self-update`/`ogb upgrade-ogb` para atualizar pelo GitHub Release pack e reaplicar o perfil OpenCode local.
- Adiciona licença MIT e metadados de repositório no pacote CLI.
- Fortalece validação estática de bootstrap/instaladores e adiciona smoke de `setup-ux --dry-run` e `self-update --dry-run`.
- Atualiza `actions/checkout`, `actions/setup-node`, `actions/upload-artifact` e `softprops/action-gh-release` para versões Node 24.

## 0.0.24 - self-update flag fix

- Usa `--release` no `self-update` para escolher uma tag sem conflitar com o `--version` global da CLI.

## 0.0.23 - superseded self-update draft

- Publicou a primeira versão do `self-update`, substituída por `0.0.24` para evitar conflito com o `--version` global da CLI.

## 0.0.17 - compact TUI status and provider limits

- Redesenha o bloco OGB da sidebar para ficar compacto, menos parecido com relatorio.
- Mantem o footer lateral nativo do OpenCode; o OGB nao injeta mais `OGB WARN` no rodape da sidebar.
- Adiciona `ogb limits`/`ogb quota`, que grava `.opencode/generated/ogb-limits.json` para a TUI sem expor tokens.
- Usa OpenUsage como fonte principal para limites de OpenAI, Anthropic e Gemini quando ele estiver rodando localmente.
- Usa fallback nativo de quota OpenAI/ChatGPT quando OpenUsage nao esta rodando e o OAuth do OpenCode existe.
- Usa fallback nativo de quota Anthropic/Claude quando OpenUsage nao esta rodando e o OAuth do OpenCode existe.
- Usa a cota Gemini Code Assist como fallback quando OpenUsage nao traz Gemini, mantendo `/gquota` como caminho manual/detalhado.
- Adiciona `session_prompt_right` discreto com limite do provedor atual e custo apenas quando existem dados reais.
- Incorpora elapsed time discreto no footer (`⏱ 12s`), inspirado no opencodeBar, mantendo o contador durante a tarefa do agente sem reiniciar entre chamadas internas.
- Redesenha limites no estilo tabela compacta do opencode-limits-sidebar, com hierarquia mais clara entre status, providers, metricas e bridge.
- Mantem o LSP nativo do OpenCode ativo e remove o patch TUI que tentava esconder esse bloco visualmente.
- Mantem `BRIDGE`, status e sync na sidebar, trocando apenas o resumo ruidoso por `GEMINI.md files · MCP servers · skills`.
- Faz o footer consultar o modelo selecionado da sessao antes da primeira resposta, evitando reaproveitar cota de outro provider quando o provider atual ainda nao e conhecido.
- Reordena a sidebar para priorizar `USAGE LIMITS` e usar seção/provedor/linhas como níveis visuais distintos.
- Faz toast/log do plugin de startup usarem timeout curto, evitando `startup sync` preso em `running` quando a UI do OpenCode nao responde.

## 0.0.16 - TUI sidebar plugin

- Adiciona plugin TUI `ogb:sidebar` para mostrar status do bridge na sidebar do OpenCode.
- Projeta `.opencode/tui-plugins/ogb-sidebar.js` e registra o plugin em `.opencode/tui.jsonc`.
- Mantem o plugin TUI fora de `.opencode/plugins/` para nao ser carregado por engano como plugin de servidor.
- Faz `ogb sync` e `ogb setup-opencode` instalarem/atualizarem a sidebar de forma gerenciada.
- Adiciona testes para instalacao, preservacao de `tui.jsonc` existente e conflito em plugin editado manualmente.

## 0.0.15 - safer `/bridge` behavior

- Ajusta o slash command `/bridge` para rodar `ogb bridge --project "$PWD"` antes de tentar ler arquivos.
- Proibe busca recursiva/glob na home dentro do prompt do comando, evitando erros de permissão no macOS.
- Explica quando o OpenCode foi aberto em `~` e o usuário esperava o status de outro projeto.

## 0.0.14 - dashboard and visible OpenCode plugin UX

- Adiciona `ogb dashboard`, que consolida doctor, validation, security, Rulesync, extensoes e startup sync em JSON e Markdown.
- Projeta o comando OpenCode `/bridge` como painel principal em linguagem simples.
- Faz o plugin de startup sync gravar `.opencode/generated/ogb-plugin-status.json`, atualizar o dashboard e mostrar toasts no OpenCode quando o sync inicia, passa ou falha.
- Atualiza instaladores Mac/Windows para terminar com dashboard final.
- Adiciona teste unitario do dashboard e valida token `dashboard` no instalador Windows.

## 0.0.12 - keep only YOLO agent

- Reverte a projecao dos agentes embutidos `automation`, `study`, `review` e `explore`.
- Mantem apenas o agente `YOLO` como agente criado pelo bridge.
- Remove automaticamente agentes antigos criados pelo `ogb` quando eles nao foram editados manualmente.
- Atualiza os comandos OpenCode para nao dependerem de agentes customizados.

## 0.0.11 - OpenCode commands, smarter doctor, extension flow

- Projeta agentes embutidos `automation`, `study`, `review`, `explore` e `YOLO` durante `ogb sync`.
- Projeta comandos OpenCode embutidos: `/doctor`, `/sync`, `/resources`, `/status`, `/update-extensions`, `/study`, `/automate`, `/review` e `/explore`.
- Faz `ogb sync` atualizar tambem `.opencode/generated/GEMINI.expanded.md`.
- Melhora `ogb doctor` com checagens de versao dos arquivos gerados, comandos/agentes embutidos ausentes, startup sync e comandos MCP no PATH.
- Adiciona `ogb install-extension` e `ogb update-extensions` como wrappers seguros do Gemini CLI.

## 0.0.10 - YOLO visual polish

- Troca o agente gerado de `.opencode/agents/yolo.md` para `.opencode/agents/YOLO.md`, deixando o nome em all caps na UI do OpenCode.
- Ajusta a cor do agente YOLO para `#ffb4b4`, mais proxima do destaque visual do Gemini CLI.
- Remove automaticamente o arquivo legado `yolo.md` quando ele foi gerenciado pelo `ogb` e nao foi editado manualmente.

## 0.0.9 - built-in YOLO agent

- Projeta o agente primario `yolo` em `.opencode/agents/yolo.md` durante `ogb sync` e `ogb import`.
- Mantem `edit` e `bash` em `allow` apenas nesse agente, sem tornar permissoes globais permissivas.
- Protege o arquivo contra sobrescrita se ele for editado manualmente, salvo com `--force`.

## 0.0.8 — safer startup sync cwd

- Corrige o plugin de startup sync para não tentar rodar `ogb sync` em `/` quando o OpenCode reporta `worktree="/"`.
- O plugin agora só roda quando encontra `.opencode/generated/ogb-startup-sync.json` em uma pasta real de projeto.

## 0.0.7 — home project dedupe

- Evita contar duas vezes MCPs e extensões quando o projeto aberto é a própria home do usuário.
- Mantém o `doctor` coerente para o caso comum de abrir `opencode` direto em `~`.

## 0.0.6 — Gemini extension MCP projection

- Lê `mcpServers` em `gemini-extension.json` de extensões Gemini globais e de projeto.
- Expande placeholders de extensão como `${extensionPath}` e `${/}` antes de escrever o config do OpenCode.
- Projeta variáveis de ambiente portáveis das extensões para `environment`, sem copiar chaves com nomes sensíveis.
- Adiciona testes para impedir regressão do MCP `gemini-md-export`.

## 0.0.5 — seamless installer flow

- Atualiza instaladores Mac/Windows para rodar `ogb import`, instalar o plugin e rodar `doctor` final.
- Corrige `setup-opencode` para preservar MCPs já presentes em `opencode.jsonc`.
- Adiciona teste para impedir regressão onde `setup-opencode` apagava MCPs.

## 0.0.4 — OpenCode actually loads MCPs and extension skills

- Corrige o sync para escrever MCPs no `opencode.jsonc` que o OpenCode realmente carrega.
- Projeta skills empacotadas em Gemini Extensions para `.opencode/skills/*`.
- Adiciona testes para MCP no config real e skills de extensões.
- Mantém as extensões Gemini como fonte imutável; copia apenas projeções geradas.

## 0.0.3 — setup OpenCode startup sync

- Adiciona `ogb setup-opencode` para instalar o plugin local de startup sync.
- Gera `.opencode/plugins/ogb-startup-sync.js` e `.opencode/generated/ogb-startup-sync.json`.
- Valida a sintaxe do plugin com `node --check`.
- Valida que o comando configurado responde `--version`.
- Protege plugin/config gerenciados por hash e exige `--force` para sobrescrever edição manual.
- Atualiza instaladores Mac/Windows para instalar o pacote CLI e rodar `setup-opencode`.
- Adiciona empacotamento local com `npm run pack:local`.
- Adiciona testes para instalação, dry-run e conflito do setup OpenCode.

## 0.0.2 — CLI MVP com Rulesync em staging

- Transforma o antigo `artifacts/bridge-cli-skeleton` em um CLI funcional para `init`, `inventory`, `flatten`, `sync`, `import`, `doctor` e `launch`.
- Corrige o flatten de `GEMINI.md` com imports aninhados, ciclos, imports ausentes, paths com espaços e code fences.
- Adiciona inventário de GEMINI files, imports, MCPs, skills, agents, commands, hooks e extensões sem logar valores de secrets.
- Integra Rulesync como motor auxiliar opcional, executado em staging temporário e promovido com proteção por hash.
- Canoniza outputs Rulesync para `.opencode/agents/*` e `.opencode/skills/*`.
- Adiciona testes unitários para flatten, inventory, config e sync nativo.

## 0.0.1 — pacote de consolidação

- Consolida as decisões da conversa sobre OpenCode Gemini Bridge.
- Inclui documentação exaustiva do objetivo, arquitetura, riscos, roadmap e mapeamento Gemini → OpenCode.
- Inclui templates de `opencode.jsonc`, agentes, commands, scripts e um esqueleto inicial de CLI.
- Inclui checklists para MVP no Mac e implantação final no Windows.
