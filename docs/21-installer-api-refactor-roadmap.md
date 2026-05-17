# Installer/API refactor roadmap

Ultima atualizacao: 2026-05-07.

Este roadmap planeja a refatoracao da instalacao do OGB como um sistema unico
Mac + Windows. Windows continua sendo o ambiente de maior risco e o stress test
principal, mas Mac entra no mesmo core e na mesma API publica para evitar dois
instaladores divergentes.

O objetivo e chegar numa API "cargo-like": poucos verbos, comportamento
previsivel, mensagens claras, e detalhes internos escondidos atras de um fluxo
confiavel.

## Objetivo

Criar uma camada nova e simples para instalar, atualizar, verificar e resetar o
OGB sem exigir que o usuario entenda `setup-ux`, `setup-opencode`, `sync`,
`doctor`, `validate`, `security-check`, `dashboard`, bootstrap, release pack,
startup plugin ou diferencas de PATH entre processos.

O caminho recomendado para usuario final deve caber em quatro comandos:

```text
ogb install
ogb update
ogb check
ogb reset
```

Esses comandos precisam funcionar com paridade no Mac e no Windows. Os scripts
de plataforma continuam existindo para bootstrap e compatibilidade, mas deixam
de conter a inteligencia principal.

## Nao-objetivos

- Nao reescrever tudo de uma vez.
- Nao remover comandos antigos imediatamente.
- Nao mudar a estrategia de sync Gemini/OpenCode neste roadmap.
- Ativar hooks `BeforeTool`/`AfterTool` de `settings.json` e extensoes automaticamente pelo plugin OGB; manter scripts soltos em revisão.
- Nao transformar startup em mecanismo de update automatico.
- Nao criar release apenas para este documento.

## Por que Mac entra no refactor

O bug mais visivel apareceu no Windows, mas a arquitetura que causou a dor e
compartilhada:

- `self-update` chama bootstrap de release pack em ambos os sistemas.
- O instalador de Mac e o de Windows repetem partes do ritual.
- `ogb pass` e o dashboard interpretam estado gerado pelos dois fluxos.
- Startup plugin, status persistido e release assets sao comuns.
- A API publica ruim afeta os dois sistemas.

Se o refactor for "Windows-only", o Mac vira uma segunda implementacao legada.
Isso aumenta o risco de corrigir um lado e quebrar o outro na proxima release.
A decisao deste roadmap e: core comum, adapters pequenos por plataforma.

## Regra de design herdada das licoes Windows

`docs/20-windows-installer-lessons.md` vira fonte normativa para este roadmap.
Cada bug real daquele documento precisa aparecer como restricao, gate ou teste.

Invariantes obrigatorias:

- Home e global, nunca projeto.
- Paths e comandos sao normalizados antes de resolver, comparar ou persistir.
- Nenhum path persistido contem aspas literais de shell.
- O fluxo nao depende do PATH herdado pelo OpenCode.
- `.cmd` e `.bat` passam por `cmd.exe`; `.exe` executa direto.
- PowerShell usa comando + array de argumentos, nao string montada.
- Stderr de comando nativo nao e falha sem exit code diferente de zero.
- O ritual completo fica em um comando canonico.
- Startup faz check/sync leve, nao update real.
- Dashboard nao pode manter estado velho como erro eterno.
- Build e pack nunca rodam em paralelo quando `build` limpa `dist`.

## API publica alvo

### `ogb install`

Instala ou reinstala o OGB e prepara a integracao com OpenCode.

Comportamento alvo:

- baixa/usa o release pack quando chamado pelo bootstrap;
- instala o CLI em local estavel;
- cria ou repara shim;
- configura PATH/env do usuario e do processo atual;
- aplica perfil global quando o projeto e home;
- aplica perfil de projeto quando o projeto nao e home;
- instala/configura startup plugin;
- termina rodando `ogb check`.

### `ogb update`

Atualiza o OGB e sempre roda o ritual completo depois.

Comportamento alvo:

- substitui `self-update` e `upgrade-ogb`;
- aceita release explicita ou `latest`;
- nunca remove o shim funcional antes de ter novo CLI pronto;
- grava status de update com diagnostico;
- roda `ogb check --force` depois da instalacao;
- deixa dashboard em estado `current` quando a versao atual ja passou.

### `ogb check`

Substitui conceitualmente `ogb pass`.

Comportamento alvo:

- roda setup leve quando necessario;
- roda sync/import;
- roda doctor;
- roda validate;
- roda security-check;
- atualiza dashboard;
- retorna exit code estavel;
- e o comando que instalador, update e usuario usam para obter PASS real.

### `ogb reset`

Reset controlado.

Comportamento alvo:

- continua permitido so em contextos seguros;
- no home, reseta perfil global e limpa artefatos antigos de projeto;
- fora do home, nao remove dados globais;
- sempre pede confirmacao quando houver apagamento destrutivo, exceto com flag
  explicita;
- termina com `ogb check`.

## Compatibilidade

Comandos antigos continuam por algumas releases com warning claro:

```text
ogb pass         -> ogb check
ogb self-update  -> ogb update
ogb upgrade-ogb  -> ogb update
```

Comandos internos continuam disponiveis para debug e automacao:

```text
setup-ux
setup-opencode
sync/import
doctor
validate
security-check
dashboard
startup-sync
```

Eles deixam de ser documentados como caminho feliz. O caminho feliz e sempre
`install`, `update`, `check`, `reset`.

## Arquitetura alvo

### Planner

Modulo comum que recebe intencao (`install`, `update`, `check`, `reset`) e
produz um plano declarativo.

O plano deve conter:

- plataforma detectada;
- home/project mode;
- arquivos que serao escritos/removidos;
- comandos nativos que serao executados;
- status que sera persistido;
- flags de seguranca;
- rollback/backup quando existir remocao.

O planner nao executa nada. Ele torna o fluxo inspecionavel e testavel.

### Runner

Modulo unico para executar comandos nativos.

Responsabilidades:

- normalizar comando;
- tratar `.cmd/.bat` e `.exe` corretamente;
- usar arrays de argumentos;
- capturar stdout/stderr/exit/signal;
- aplicar timeout;
- produzir diagnostico estruturado;
- nunca transformar warning em erro sem exit code.

### State store

Modulo comum para ler/escrever estado OGB.

Responsabilidades:

- status de install/update/check/startup;
- timestamps confiaveis;
- versao do OGB que gerou cada relatorio;
- tails de stdout/stderr quando algo falha;
- schema simples e evolutivo;
- compatibilidade com relatorios antigos.

### Platform adapters

Camadas finas para Mac e Windows.

Responsabilidades:

- descobrir prefixo/local de instalacao;
- persistir env/PATH na forma nativa;
- localizar `node`, `npm`, `opencode`, `gemini`;
- aplicar diferencas de shell;
- chamar o core comum.

### CLI

Camada publica.

Responsabilidades:

- expor `install`, `update`, `check`, `reset`;
- manter aliases antigos com warning;
- imprimir mensagens humanas curtas;
- encaminhar detalhes para relatorios JSON/dashboard;
- manter exit codes estaveis.

## Release 1 - Contrato publico e compatibilidade

Objetivo: introduzir a API nova sem mexer profundamente na implementacao.

Mudancas:

- adicionar `ogb check` como wrapper canonico de `pass`;
- adicionar `ogb update` como wrapper canonico de `self-update`;
- adicionar `ogb install` como wrapper que chama o fluxo atual de instalacao
  quando o CLI ja esta disponivel, e documenta que bootstrap ainda e externo;
- manter `ogb reset` como verbo publico, ajustando mensagens para a nova API;
- adicionar warnings nos aliases antigos;
- documentar a API nova em README/docs;
- garantir que instaladores terminem falando `ogb check`, nao `ogb pass`;
- estabilizar mensagens e exit codes minimos.

Gate:

```text
Mac e Windows conseguem rodar install/update/check/reset sem comandos manuais
extras, mesmo que internamente ainda usem partes antigas.
```

Testes obrigatorios:

- `ogb check` gera o mesmo resultado funcional de `ogb pass`;
- `ogb pass` funciona e emite warning de alias;
- `ogb update --release vX.Y.Z` chama o fluxo de update e check;
- `ogb self-update` funciona e emite warning de alias;
- install/update/check/reset aparecem no help;
- README e docs nao apresentam `pass` como caminho feliz;
- scripts Mac/Windows imprimem `check` no comando final;
- dashboard nao fica preso em `restartRequired` apos check limpo.

## Release 2 - Core comum e scripts finos

Objetivo: extrair a logica comum para planner, runner, state store e adapters.

Mudancas:

- criar planner declarativo para `install`, `update`, `check`, `reset`;
- criar runner unico de comandos nativos;
- mover normalizacao de path/comando para a borda comum;
- mover escrita/leitura de status para state store;
- fazer scripts Mac/Windows apenas baixar release pack e chamar o CLI;
- reduzir duplicacao entre install scripts, self-update e post-update ritual;
- manter compatibilidade com relatorios antigos;
- manter startup plugin chamando comando dedicado e leve.

Gate:

```text
Scripts de plataforma deixam de decidir o ritual. Eles fazem bootstrap e
delegam para o CLI comum.
```

Testes obrigatorios:

- planner gera plano de install para Mac e Windows sem executar;
- planner detecta home/global e projeto real;
- planner normaliza paths quoteados antes de comparar home;
- runner executa `.cmd/.bat` via `cmd.exe` no Windows;
- runner executa `.exe` direto;
- runner tolera stderr com exit 0;
- state store consome status antigo sem quebrar dashboard;
- `install --dry-run` mostra plano sem escrever arquivos de projeto;
- `update --dry-run` mostra plano sem tocar shim;
- scripts Mac/Windows passam validacao estatica e chamam o CLI comum.

## Release 3 - Migracao e simplificacao

Objetivo: remover duplicacao operacional e rebaixar a API antiga para camada de
compatibilidade documentada.

Mudancas:

- remover comportamento duplicado de install/update/check nos scripts;
- mover fluxo de post-update para planner/check comum;
- fazer dashboard ler status do state store;
- limpar mensagens antigas que recomendam `pass`, `self-update` ou reset
  desnecessario;
- reduzir docs publicos ao caminho `install/update/check/reset`;
- marcar comandos internos como debug/advanced;
- definir prazo de remocao dos aliases antigos.

Gate:

```text
Nenhum bug conhecido de Windows volta nos testes, e o caminho recomendado cabe
em quatro comandos: install, update, check, reset.
```

Testes obrigatorios:

- matriz Mac/Windows completa passa;
- release pack contem `dist` novo e scripts finos;
- self-update via `latest` e via release explicita terminam em check limpo;
- startup sync nao faz update real;
- dashboard nao transforma relatorio antigo em FAIL atual;
- home/global nunca cria `.opencode/generated`;
- nenhum script shell/PowerShell contem sequencia manual doctor/validate/security/dashboard;
- aliases antigos emitem warning e continuam funcionando.

## Matriz minima Mac/Windows

Mac:

- install em projeto real;
- install/update/check/reset em home/global;
- PATH nao ativo no shell atual;
- OpenCode ja aberto antes da instalacao;
- release pack baixado por bootstrap;
- `update --release vX.Y.Z`;
- `update` via latest.

Windows:

- PowerShell 7;
- Windows PowerShell 5.1, se mantido como suportado;
- Node em `C:\Program Files\nodejs`;
- `npm.cmd`, `opencode.cmd`, `gemini.cmd` fora do PATH inicial;
- `%USERPROFILE%` normal;
- `--project` quoteado e duplamente quoteado;
- home/global;
- projeto fora da home;
- OpenCode aberto antes de PATH/env mudar;
- self-update via release explicita;
- self-update via latest;
- startup sync com burst de eventos;
- startup sync com lock morto;
- warning em stderr com exit 0.

Ambos:

- `ogb check` e o unico ritual completo recomendado;
- `ogb update` sempre roda check depois;
- dashboard PASS depois de check limpo;
- reset nao apaga fora do escopo seguro;
- pack roda depois de build, nunca em paralelo.

## Rollback

Cada release precisa ter rollback simples:

- aliases antigos continuam funcionando;
- scripts antigos continuam no release pack ate a Release 3 terminar;
- status JSON novo deve ser lido com fallback para formato antigo;
- se planner novo falhar, comando pode cair para fluxo legado com warning;
- shim funcional nunca deve ser removido antes de novo CLI ser validado;
- `ogb check` deve conseguir reparar estado parcialmente migrado.

Rollback nao pode depender de reset destrutivo.

## Criterios para remover aliases antigos

Aliases antigos so podem ser removidos quando todos forem verdadeiros:

- duas releases publicadas com warning de alias;
- README e docs publicos usam apenas `install/update/check/reset`;
- instaladores Mac/Windows imprimem apenas comandos novos;
- dashboard e TUI nao recomendam comandos antigos;
- telemetria/local reports nao mostram uso relevante dos aliases antigos, se
  houver dado disponivel;
- existe changelog claro anunciando a remocao;
- um ultimo release pack com aliases ainda funcionais esta disponivel para
  rollback manual.

## Definition of done do roadmap

Este roadmap termina quando:

- `ogb install` e o caminho unico de instalacao/reinstalacao;
- `ogb update` e o caminho unico de update;
- `ogb check` substitui `pass` como ritual completo;
- `ogb reset` continua seguro e explicito;
- scripts Mac/Windows sao wrappers finos;
- todos os bugs reais do doc de licoes estao cobertos por teste;
- o usuario final nao precisa saber quais subcomandos internos existem.
