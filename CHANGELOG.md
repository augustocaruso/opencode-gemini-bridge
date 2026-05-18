# Changelog

## 0.1.60 - Reparo real da projeção Antigravity no Windows

- Repara roots Antigravity `skills`/`agents` que ficaram como symlinks Windows quebrados ou inatravessáveis, removendo o link com `--force` sem apagar o alvo e recriando uma árvore real.
- Fecha o caso em que o sync dizia OK, mas `~\.gemini\antigravity\skills` e `~\.gemini\antigravity\agents` continuavam como reparse points para `~\.config\opencode`, gerando `untrusted mount point` e deixando Antigravity sem projeção verificável.
- Adiciona regressão cobrindo roots Antigravity como symlink e conferindo que skills e agents nativos voltam a ser materializados.

## 0.1.57 - Sintaxe PowerShell do reparo ReadOnly

- Corrige a interpolacao PowerShell `${Operation}:` nos instaladores Windows para manter o parser do CI Windows/Linux limpo.
- Esta e a versao de release publicada para substituir as tags `v0.1.53` a `v0.1.56`, que falharam antes de fechar todos os checks.

## 0.1.56 - Release Windows ReadOnly com CI separado

- Mantem a regressao home-mode do bug Windows no job Windows e evita que o release pack Linux falhe tentando simular `path.win32` em POSIX.
- Esta e a versao de release publicada para substituir as tags `v0.1.53`, `v0.1.54` e `v0.1.55`, que falharam antes de gerar artefatos.

## 0.1.55 - Release do reparo Windows ReadOnly

- Publica o reparo do `EEXIST`/`ReadOnly` com a regressao home-mode ajustada para CI Linux, macOS e Windows.
- Esta e a versao de release publicada para substituir as tags `v0.1.53` e `v0.1.54`, que falharam antes de gerar artefatos.

## 0.1.54 - Reparo real do OpenCode ReadOnly no Windows

- Mantem a correcao do `EEXIST` do OpenCode no Windows e ajusta a regressao para rodar igual em CI Linux/macOS/Windows.
- Esta e a versao de release publicada para substituir a tag `v0.1.53`, que falhou antes de gerar artefatos.

## 0.1.53 - Check nao espera o OpenCode quebrado no Windows

- Quando `opencode debug config` falha com `EEXIST: file already exists, mkdir ...\\.config\\opencode` e esse alvo ja e um diretorio valido, o OGB agora pula imediatamente o probe do OpenCode em vez de tentar um segundo probe com guard.
- Fecha o caso real em que o segundo probe travava ate `spawnSync C:\\WINDOWS\\system32\\cmd.exe ETIMEDOUT`, mantendo `ogb validate/check/update` em `FAIL` apesar dos arquivos gerenciados ja estarem validados.
- O bootstrap, instalador Windows, setup e validação agora limpam automaticamente o atributo Windows `ReadOnly` de `~\\.config\\opencode`, que fazia o Bun do OpenCode morrer com `EEXIST` mesmo quando a pasta ja existia corretamente.
- Atualiza as regressoes para garantir que o guard nao seja invocado nesse caminho conhecido.

## 0.1.52 - Fallback real para EEXIST do OpenCode no Windows

- Quando `opencode debug config` continua falhando com `EEXIST: file already exists, mkdir ...\\.config\\opencode` mesmo depois do guard com `OPENCODE_CONFIG_DIR` e `XDG_*`, o OGB agora pula apenas esse probe quebrado e usa a validação direta dos arquivos gerenciados.
- Fecha o caso em que `ogb update` ainda terminava em `FAIL` porque dependia do JSON de debug do OpenCode, apesar de a config global, instructions, plugin, comandos e agentes do OGB ja terem sido validados.
- Adiciona regressao para o erro persistente com `Bun v1.3.13 (Windows x64 baseline)`, garantindo que esse caminho conhecido nao volte a derrubar o post-check.

## 0.1.51 - Guard para mkdir do OpenCode no Windows

- Quando `opencode debug config` falha no Windows com `EEXIST: file already exists, mkdir ...\\.config\\opencode` mas o alvo ja e um diretorio valido, o OGB agora reroda o probe com `OPENCODE_CONFIG_DIR` apontando para a config real e `XDG_*` temporario.
- Fecha o caso em que o post-check continuava falhando mesmo depois dos reparos de arquivo bloqueador, porque nao havia arquivo a mover: o problema era o `mkdir` do proprio runtime OpenCode/Bun.
- Adiciona regressao para o formato real do erro com `path: "C:\\Users\\...\\.config\\opencode", syscall: "mkdir", errno: -17, code: "EEXIST"`.

## 0.1.50 - Validação repara o path exato do OpenCode

- Quando `opencode debug config` falha com `EEXIST: file already exists, mkdir ...\\.config\\opencode`, o OGB agora extrai o path exato reportado pelo OpenCode, faz backup, repara a pasta e tenta a validação novamente.
- Fecha o caso em que o reparo prévio calculava um caminho, mas o OpenCode quebrava em outro durante o post-check do `ogb update`.
- Falhas de filesystem na projeção auxiliar de agentes/workflows Antigravity agora viram notas não-bloqueantes, preservando o sync do OpenCode sem transformar o check em FAIL.

## 0.1.49 - Bootstrap repara OpenCode bloqueado

- Faz o bootstrap e o instalador Windows repararem, com backup, um arquivo antigo ocupando `~/.config/opencode` antes de chamar qualquer `mkdir`.
- Fecha o caso em que o `opencode` puro morria com `EEXIST: file already exists, mkdir ...\\.config\\opencode` antes do plugin do OGB conseguir carregar.

## 0.1.48 - Update mostra o blocker real

- Faz `ogb update` aproveitar o resumo final do `ogb check --progress-json` quando o post-check falha.
- Para de mostrar NDJSON truncado como problema principal e passa a exibir blocker, proxima acao e reports gerados pelo proprio check.

## 0.1.47 - Validação repara diretório global bloqueado

- Faz a etapa de validação reparar, com backup, um arquivo antigo ocupando `~/.config/opencode` antes de chamar `opencode debug config`.
- Fecha o caso em que o sync/setup reparava recursos, mas o post-update check ainda falhava com `EEXIST: file already exists, mkdir .../.config/opencode`.

## 0.1.46 - Reparo do diretório global OpenCode

- Faz `setup-ux` e `sync` repararem, com backup, um arquivo antigo ocupando o caminho `~/.config/opencode`.
- Evita que o post-update check termine em `EEXIST: file already exists, mkdir .../.config/opencode` durante `opencode debug config`.

## 0.1.45 - Notas visiveis para sync parcial

- Mantem projeções Antigravity bloqueadas por `untrusted mount point` fora dos blockers do `check`.
- Registra a perda parcial como nota explicita no sync/check, inclusive na UI rica, para nao esconder compatibilidade opcional quebrada.

## 0.1.44 - Check sem bronca por anexos grandes

- Compacta snapshots de telemetria do Medical Notes Workbench antes do reenvio para evitar `413 body_too_large` no worker padrao.
- Mantem o snapshot local preservado e reduz scripts/diffs grandes em camadas antes de enviar o envelope.
- Ignora projeções Antigravity bloqueadas por `untrusted mount point` no Windows, sem transformar o sync do OpenCode em warning/fail.

## 0.1.43 - Hooks globais preservam o workspace

- Faz o plugin global do OpenCode cair para o estado global do OGB quando o workspace atual ainda não tem configuração de projeto.
- Preserva o diretório real da sessão no payload dos hooks Gemini, para guards como o vault guard avaliarem o workspace correto.
- Adiciona regressão cobrindo hooks globais de extensão rodando em workspaces comuns, sem `.opencode/generated` local.

## 0.1.42 - Update repara bloqueios antigos

- Faz o sync com `--force` reparar arquivos legados que bloqueiam diretórios de projeção, criando backup central antes de remover o bloqueio.
- Aplica o reparo a skills, agentes, comandos, workflows e MCPs gerenciados, reduzindo warnings para casos realmente ambíguos.
- Troca a regressão anterior de "não quebrar" por "reparar e projetar", cobrindo o caso de `~/.config/opencode/skills` deixado como arquivo legado.

## 0.1.41 - Update resiliente a projeções antigas

- Faz o inventário ignorar raízes globais inválidas, como `skills`/`agents` antigos deixados como arquivo em vez de diretório, sem derrubar `ogb update`.
- Faz falhas pontuais ao projetar comandos, agentes, skills e workflows virarem warnings por recurso, mantendo o sync do restante do ambiente.
- Adiciona regressão de home-mode para garantir que uma skill global bloqueada não transforme o post-update inteiro em `FAIL`.

## 0.1.40 - Check global em Windows

- Faz `ogb check` em modo home aplicar o perfil global mínimo do OpenCode antes de validar, corrigindo post-update que falhava por falta do plugin global `ogb-startup-sync.js` e do agente `YOLO.md`.
- Mantém o reparo de check sem instalar OpenCode, plugins externos ou dependências TUI; `setup-ux` continua sendo o fluxo completo para a UX global rica.
- Adiciona regressão para garantir que o home-mode materialize `opencode.json`, `YOLO.md`, plugin de startup e config de startup antes dos checks finais.
- Valida o release em CI real `ubuntu-latest` e `windows-latest`, incluindo smoke de home-mode no Windows.

## 0.1.39 - Plugin global por URL absoluta

- Corrige o `setup-ux` para configurar o plugin global `ogb-startup-sync.js` como URL absoluta `file:///...`, em vez do spec legado `file:plugins/...` que o OpenCode tentava instalar como pacote.
- Faz o `setup-ux` remover o spec legado quando ele aparece em configs antigas e avisar que a troca foi aplicada.
- Faz `doctor` e `validate` falharem quando a config global ainda contém o spec legado, mesmo se a URL correta também estiver presente.

## 0.1.38 - Hooks Gemini sem opt-in

- Faz hooks Gemini `BeforeTool`/`AfterTool` de `settings.json` e extensões rodarem automaticamente pelo plugin OGB do OpenCode durante o fluxo normal de sync.
- Mapeia nomes de ferramentas entre OpenCode e Gemini, incluindo `bash`/`run_shell_command`, e respeita `decision: "deny"`/`"block"`, exit code `2` e reescrita de `tool_input`.
- Mantém scripts soltos e eventos sem equivalente OpenCode como superfície de auditoria, sem bloquear o caminho normal de `ogb sync`.
- Atualiza o `AGENTS.md` global distribuído para orientação de terminal neutra ao sistema operacional.
- Expande permissões de leitura do agente Plan, incluindo comandos GitHub CLI somente-leitura.

## 0.1.37 - Reparo global pos-sync

- Faz o `ogb check --force` rodar um sync global antes do sync de projeto, limpando projeções antigas em `~/.config/opencode`.
- Normaliza modelos Gemini sem provider para `google/...` em agentes projetados, tanto globais quanto de projeto.
- Remove agentes globais órfãos, deduplica skills gerenciadas entre global/projeto e limpa a árvore duplicada `.config/opencode/opencode`.
- Atualiza o `AGENTS.md` global distribuído para orientação de terminal neutra entre macOS/Linux e Windows.

## 0.1.36 - Instalador global duravel

- Corrige o bootstrap POSIX para instalar o OGB a partir de um tarball empacotado, nao de um diretorio temporario.
- Evita que `/opt/homebrew/bin/ogb` vire um symlink quebrado depois da limpeza do `ogb-bootstrap.*`.
- Adiciona teste que falha se o instalador voltar a fazer `npm install -g "$CLI_DIR"`.

## 0.1.35 - Permissoes de leitura no Plan

- Adiciona uma allowlist compartilhada para comandos Bash somente-leitura em agentes OpenCode.
- Projeta a allowlist no agente padrao e no agente Plan, mantendo edicoes como `ask` e comandos destrutivos como `deny`.
- Faz o `setup-ux` mesclar permissoes aninhadas sem apagar entradas manuais existentes.

## 0.1.34 - UI rica compacta em terminais curtos

- Evita o fallback de tela cheia do Ink quando o painel do update passa da altura do terminal.
- Compacta TODOs, problemas e proximos passos em terminais curtos para manter o spinner incremental.
- Adiciona testes que falham se ticks do spinner ou relatorios finais emitirem `clearTerminal`.

## 0.1.33 - Ink 7 com render incremental

- Migra a UI rica para Ink 7 e assume Node.js >=22 como requisito oficial.
- Usa `incrementalRendering` e `maxFps` para impedir que ticks do spinner redesenhem o painel inteiro.
- Troca o ticker manual do spinner por `useAnimation` e remove a linha experimental de atividade no rodape.
- Faz os instaladores macOS, Linux e Windows falharem cedo quando o Node.js instalado for antigo.

## 0.1.32 - Spinner volta com redraw controlado

- Reativa o spinner da UI rica por padrao em terminais interativos seguros.
- Reduz o redraw animado para um intervalo mais calmo, evitando a avalanche ANSI do update longo.
- Permite desativar a animacao com `OGB_UI_ANIMATE=0`.

## 0.1.31 - Update sem redraw agressivo

- Para de animar a UI rica por padrao, evitando redraws ANSI periodicos enquanto bootstrap/check ficam sem output.
- Desliga a UI rica em terminais com menos de 80 colunas, caindo no modo texto estavel em pseudo-TTYs estreitos.
- Mantem animacao apenas como opt-in explicito via `OGB_UI_ANIMATE=1`.

## 0.1.30 - Update desliga UI rica em transcripts

- Desliga automaticamente a UI Ink quando o terminal anuncia `TERM=dumb` ou o shell vem do Codex, evitando frames ANSI repetidos no transcript.
- Mantem o modo texto/classico como fallback nesses ambientes, preservando a UI rica em terminais humanos interativos.

## 0.1.29 - Update mostra WARN quando post-check avisa

- Faz a UI rica do update exibir `WARN` quando o bootstrap aplica com sucesso, mas o post-check termina com avisos.
- Evita o texto enganoso de final limpo em updates aplicados com warnings.

## 0.1.28 - UI de update compacta logs ruidosos

- Compacta mensagens exibidas pela UI rica antes de renderizar steps e callouts, removendo ANSI, carriage returns e medidores de transferencia do `curl`.
- Limita linhas longas do painel para evitar que tails de bootstrap quebrem a borda ou poluam o TODO/final report.
- Mantem os diagnosticos completos nos reports e no modo `--plain`.

## 0.1.27 - Update tolera warnings

- Atualiza o sync para refrescar hashes gerenciados quando a skill Antigravity existente ja bate com a projecao atual, evitando falso conflito de edicao manual.
- Faz os instaladores tratarem `ogb install` com exit 1 como instalacao concluida com avisos, permitindo que `ogb update` finalize e reporte o post-check WARN corretamente.
- Mantem falha real para exit codes maiores que 1.

## 0.1.25 - Migração segura de skills Antigravity

- Adota projeções Antigravity já existentes quando o conteúdo é idêntico ao que o OGB geraria, registrando-as no estado gerenciado sem overwrite.
- Mantém conflito para diretórios diferentes ou editados manualmente, preservando o contrato de só remover/sobrescrever arquivos gerenciados.
- Cobre a migração com testes para adoção segura e preservação de conteúdo não gerenciado.

## 0.1.24 - Warnings opcionais silenciosos

- Para de persistir warning quando OpenUsage esta offline e os fallbacks opcionais de OpenAI/Claude nao estao autenticados.
- Mantem o estado interno das fontes como `unavailable`, sem transformar ausencia de provedor opcional em acao para o usuario.

## 0.1.2 - Gemini auth resiliente e update de extensoes

- Faz `ogb check` atualizar Gemini Extensions antes do sync, com `--no-extension-update` para pular a etapa quando necessario.
- Adiciona `ogb update-extensions --auto-consent`/`--yes`, captura stderr/stdout e transforma falhas do Gemini CLI em diagnostico acionavel.
- Melhora o fallback de quota Gemini para tentar clientes OAuth Gemini e Antigravity, ignorar project IDs corrompidos e mostrar erros reais do Google OAuth.
- Mantem OpenAI/Claude/Gemini na UI de limites com mensagens mais claras quando OpenUsage esta offline ou o token precisa ser reautenticado.

## 0.1.1 - Progresso publico e perfil seguro

- Estabiliza `--progress-json` como contrato publico NDJSON para `install`, `update`, `check`, `reset` e aliases legados.
- Faz a UI rica consumir eventos de um processo filho, mantendo spinner e resize responsivos durante etapas longas.
- Centraliza backups do perfil OpenCode/OGB com retencao, dry-run e protecao de mantenedor local.
- Reorganiza `setup-ux` para escrever o perfil a partir do preset gerado, preservando campos desconhecidos e backup antes de overwrite.
- Ajusta telemetria para separar execucoes humanas de automacao/CI/Codex e manter autoenvio fail-open.
- Adiciona skill `ogb-operator` para orientar usuarios e agentes sobre install, update, check, reset e debug do OGB.

## 0.1.0 - Release 2 do instalador cargo-like

- Consolida a API publica em `ogb install`, `ogb update`, `ogb check` e `ogb reset`, mantendo aliases antigos com aviso.
- Extrai o core comum de instalacao em planner, runner nativo, state store e platform adapters para Mac e Windows.
- Faz os scripts de plataforma delegarem o ritual ao CLI comum, reduzindo duplicacao entre install, update, check e reset.
- Adiciona UI Ink responsiva para rituais e `ogb help`, com lista interativa, selecao por Enter e execucao do comando selecionado.
- Amplia a cobertura de testes para contratos do planner, runner, state store, adapters, scripts Mac/Windows, dashboard e help interativo.
- Suprime autoenvio de telemetria em contextos Codex, CI e testes, mantendo os registros locais para diagnostico.

## 0.0.61 - Limpa restart do self-update latest

- Corrige o dashboard para consumir o aviso de restart tambem quando `self-update` foi feito contra `latest` e o status antigo nao registrou `latestTag`.
- Mantem a exigencia de `validate` e `security-check` limpos na versao atual antes de limpar o aviso.

## 0.0.60 - Installer e restart consumivel

- Faz os instaladores Mac e Windows terminarem em `ogb pass` (`--windows` no Windows), para setup, sync, doctor, validate, security-check e dashboard sairem do instalador ja regenerados.
- Consome o estado `restartRequired` do update quando o OGB atual ja e a versao aplicada e os relatorios de pass foram gerados depois do update.
- Impede a sidebar/dashboard de manterem `update applied · restart OpenCode` para sempre depois de um pass limpo.

## 0.0.59 - Update com pass completo

- Faz `self-update` e `auto-update` gravarem o status de update e rodarem `ogb pass --force` logo depois, regenerando sync, doctor, validation, security e dashboard no mesmo fluxo.
- Mantem `restart OpenCode` como proximo passo informativo, sem transformar um bridge limpo em `WARN`.
- Corrige comandos diretos do plugin para remover `--project` duplicado antes de chamar `doctor`, `bridge` ou outros comandos.
- Faz `/bridge` rodar o healthcheck completo (`ogb pass`) em vez de apenas reler dashboard antigo.
- Ignora duplicatas de skills OpenCode quando projeto e global carregam a mesma copia byte a byte.

## 0.0.58 - Contagem global sem somar fonte e destino

- Faz o inventario tratar a home como global de verdade, evitando `scope: project` para recursos em `~/.gemini` quando `--project` e a home.
- Para de incluir `~/GEMINI.md`, `~/.opencode/*` e outras raizes de projeto quando o OGB esta rodando no home/global.
- Mantem o inventario mostrando fontes Gemini e destinos OpenCode, mas muda as contagens do doctor/dashboard para skills, agentes e comandos OpenCode de destino.
- Evita que uma skill fonte em `~/.gemini/skills` e sua copia em `~/.config/opencode/skills` sejam somadas como duas skills do OpenCode.

## 0.0.57 - Windows cmd shims com argumentos verbatim

- Envolve a linha inteira de `.cmd/.bat` no formato `""shim.cmd" args"` esperado pelo `cmd.exe /d /s /c`.
- Usa `windowsVerbatimArguments` quando o OGB precisa passar por `cmd.exe`, evitando que o Node re-escape aspas e o Windows tente executar `\"C:\...\opencode.cmd\"` como texto literal.
- Atualiza o plugin de startup gerado para usar o mesmo caminho verbatim.
- Amplia testes para garantir que shims `.cmd` usam outer quotes, `windowsVerbatimArguments` e continuam sem `call`.

## 0.0.56 - Windows validate sem falso FAIL pos-update

- Troca o runner Windows para executar shims `.cmd/.bat` via `cmd.exe /d /s /c "<shim.cmd>" ...`, sem `call`, mantendo `.exe` direto.
- Normaliza tambem aspas externas escapadas, como `\"C:\...\opencode.cmd\"`, antes de resolver ou executar comandos.
- Atualiza o plugin de startup gerado para usar o mesmo runner sem `call`.
- Adiciona `generatedAt` aos relatorios de `validate` e `security-check`.
- Faz o dashboard tratar relatorios antigos ou gerados antes do ultimo `self-update` como aviso para regenerar, nao como FAIL atual.
- Ajusta a mensagem de `self-update` para pedir restart do OpenCode e `ogb validate`, sem pedir reset.

## 0.0.55 - Windows valida comandos sem aspas literais

- Normaliza caminhos de comandos antes de resolver/executar `npm.cmd`, `gemini.cmd`, `opencode.cmd` e `ogb.cmd`, removendo aspas externas acidentais vindas do PATH/where/npm prefix.
- Faz o runner Windows montar `cmd.exe /c call ...` usando o caminho limpo, evitando erros como `"C:\...\opencode.cmd" nao e reconhecido`.
- Atualiza o plugin de startup gerado para aplicar a mesma limpeza antes de executar o OGB.
- Adiciona testes cobrindo paths `.cmd` e `.exe` quoteados no resolvedor e no runner Windows.

## 0.0.54 - Dashboard ignora relatorios obsoletos

- Faz o dashboard tratar `ogb-validation.json` e `ogb-security.json` de versoes antigas como aviso para regenerar, nao como FAIL atual.
- No modo home/global, detecta relatorios antigos que ainda procuram `.opencode/generated/opencode.generated.json` ou `.opencode/agents/YOLO.md` dentro da home e evita falso vermelho.
- Ignora erro antigo de auto-update quando o status foi gravado por uma versao anterior do OGB, para o painel nao manter `OGB update: ERROR` depois de update bem-sucedido.
- Reproduz o perfil pessoal de `modelFallbacks` no modo home/global, gravando `~/.config/opencode-gemini-bridge/ogb.config.jsonc` e aplicando `model`/`fallback_models` aos agentes globais vindos das extensoes Gemini.

## 0.0.53 - Dashboard global sem falso FAIL

- Gera `ogb-extension-map.json` tambem no modo home/global, em `~/.config/opencode-gemini-bridge/generated`, para extensoes Gemini virarem inventario de revisao em vez de warnings genericos permanentes.
- Faz `doctor`, `validate` e `security-check` entenderem o perfil global: config em `~/.config/opencode`, contexto em `~/.config/opencode-gemini-bridge/generated` e YOLO global em `~/.config/opencode/agents/YOLO.md`.
- Ajusta o dashboard para mostrar a primeira causa real de falha em validation/security, em vez de apenas `validation falhou` ou `security falhou`.
- Faz `self-update` bem-sucedido sobrescrever status antigo de erro de update, evitando `OGB update: ERROR` obsoleto no dashboard.
- Adiciona testes de sync global, doctor, validate, security-check, dashboard e self-update para cobrir o modo home/global.

## 0.0.52 - Windows quoted home path hotfix

- Normaliza paths recebidos com aspas externas acidentais antes de resolver `--project`, `homeDir` e prefixos de instalacao.
- Faz `sync`, `startup-sync`, `setup-ux`, `reset`, `doctor` e `dashboard` tratarem `"C:\Users\usuario"` como home/global, nao como projeto dentro do home.
- Corrige o bootstrap/installer Windows para limpar `-Project` e `-Prefix` antes de chamar `GetFullPath` ou repassar argumentos.
- Adiciona testes cobrindo home quoteado, startup sync global, reset global e validacao estatica dos scripts Windows.

## 0.0.51 - Startup sync sem depender do PATH do Windows

- Faz `setup-ux` gravar `node` absoluto + `dist/cli.js` absoluto quando roda a versao empacotada, evitando depender do PATH herdado pelo processo do OpenCode no Windows.
- Quando o CLI empacotado nao esta disponivel, faz fallback para o caminho resolvido de `ogb.cmd` em vez de `command: "ogb"`.
- Adiciona teste simulando Windows/AppData para garantir que `ogb-startup-sync.json` aponta para `ogb.cmd` absoluto.

## 0.0.50 - Startup sync global sem spam

- Troca o plugin de startup para usar `ogb startup-sync`, um caminho dedicado que trata avisos de hooks/extensoes como avisos e so falha em erro real de projecao.
- Faz o startup sync rodar no maximo uma vez por processo do OpenCode e respeitar backoff de 10 minutos depois de falha, sem reagir a `session.updated` ou `session.idle`.
- Desliga update automatico no startup por padrao; o plugin no maximo usa check silencioso quando explicitamente habilitado, enquanto update real fica em `ogb self-update` ou `/upgrade-ogb`.
- Registra diagnosticos de falha no status do plugin, incluindo stdout/stderr tail, signal, comando, args, contagem de falhas e proxima tentativa.
- Mostra no dashboard a causa curta da falha de startup sync, em vez de apenas `exit code 1`.
- Adiciona testes para lifecycle do plugin, backoff, diagnostico do dashboard e sync global de startup.

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
