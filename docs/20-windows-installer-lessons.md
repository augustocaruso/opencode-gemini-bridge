# Windows installer lessons

Ultima atualizacao: 2026-05-06.

Este documento registra o que aprendemos do jeito dificil ao fazer o OGB
instalar, atualizar, sincronizar e diagnosticar corretamente no Windows. Ele
deve ser lido antes de mexer em:

- `scripts/bootstrap-windows.ps1`
- `scripts/install-windows.ps1`
- `packages/ogb/src/command-resolution.ts`
- `packages/ogb/src/process.ts`
- `packages/ogb/src/self-update.ts`
- `packages/ogb/src/dashboard.ts`
- `packages/ogb/src/setup-ux.ts`
- `packages/ogb/src/setup-opencode.ts`

O objetivo nao e explicar PowerShell do zero. O objetivo e impedir que a gente
repita a mesma sequencia exaustiva de falso PASS, falso FAIL, shim quebrado,
path com aspas literais, plugin que roda com PATH velho e dashboard pedindo
restart para sempre.

## Modelo mental

O instalador Windows nao e "um script que copia arquivos". Ele e uma maquina de
estado com varias fronteiras frageis:

1. PowerShell baixa e executa o bootstrap.
2. O bootstrap baixa o release pack.
3. O instalador escolhe um local estavel para o CLI.
4. O shim `ogb.cmd` aponta para `node.exe` + `dist/cli.js`.
5. O perfil global do OpenCode e reescrito.
6. O sync global/projeto e executado.
7. O plugin de startup e configurado.
8. `ogb pass` roda o ritual completo: setup, sync, doctor, validate,
   security-check e dashboard.
9. O dashboard interpreta relatorios persistidos que podem ter sido gerados por
   uma versao anterior.
10. O OpenCode reinicia em outro processo, com outro ambiente e outro PATH.

Qualquer bug em uma fronteira parece bug em outra. Exemplo: "plugin nao carrega"
pode ser plugin ausente, PATH herdado sem `node`, lock antigo, processo curto que
marcou `running`, config global errada, ou dashboard lendo status velho.

Regra geral: cada fronteira precisa persistir estado suficiente para diagnostico
e precisa ter teste de regressao.

## Invariantes que nao podem quebrar

1. Home e global, nunca projeto.

   Se `--project` aponta para `%USERPROFILE%`, mesmo acidentalmente como
   `'"C:\Users\leona"'`, o OGB deve tratar como home/global. Nao pode criar
   `%USERPROFILE%\.opencode\generated`, `%USERPROFILE%\opencode.jsonc` ou
   `%USERPROFILE%\.opencode\agents` como se a home fosse um projeto.

2. Todo input de path deve passar por normalizacao central.

   Remover espacos nas bordas e aspas externas balanceadas, inclusive aspas
   escapadas ou aninhadas, antes de qualquer `path.resolve`,
   `[System.IO.Path]::GetFullPath`, comparacao com home, ou persistencia em
   config.

   Casos obrigatorios:

   - `C:\Users\leona`
   - `"C:\Users\leona"`
   - `'C:\Users\leona'`
   - `'"C:\Users\leona"'`
   - `\"C:\Users\leona\"`

3. Nunca persista path com aspas literais.

   Aspas sao sintaxe de shell, nao parte do path. Se `ogb-startup-sync.json`,
   `opencode.json`, `ogb-update-status.json` ou qualquer script persistido
   contem `"C:\Users\leona"` como texto literal dentro do path, o proximo
   processo vai duplicar caminho ou tentar executar um arquivo inexistente.

4. Nao dependa do PATH herdado pelo OpenCode.

   O terminal do usuario, o instalador, o OpenCode e o plugin de startup podem
   herdar ambientes diferentes. No Windows, o startup config deve preferir:

   - caminho absoluto de `node.exe`;
   - caminho absoluto de `dist/cli.js`;
   - fallback para `ogb.cmd` resolvido;
   - nunca apenas `"ogb"` quando existe CLI empacotado.

5. `.cmd` e `.bat` nao sao executaveis diretos para Node.

   Node documenta que `.bat` e `.cmd` no Windows precisam de terminal/shell. No
   OGB, o padrao correto e montar `cmd.exe` explicitamente:

   ```text
   cmd.exe /d /s /c ""C:\path with spaces\opencode.cmd" arg1 arg2"
   ```

   No runner Node, usar `windowsVerbatimArguments` para evitar que o Node
   re-escape a linha e transforme aspas em texto literal. `.exe` continua sendo
   executado diretamente.

6. No PowerShell, comando e argumentos devem ser arrays.

   Preferir:

   ```powershell
   $Args = @("--project", $Project, "pass", "--windows")
   & $OgbBin @Args
   ```

   Evitar montar uma string unica com comando + argumentos. A string unica vira
   uma segunda linguagem de quoting, e o erro so aparece na maquina real.

7. Warnings de comandos nativos nao podem virar falha do instalador.

   `npm.cmd` pode escrever warning em stderr e sair `0`. PowerShell 7 tem
   comportamento configuravel para comandos nativos e stderr; o instalador deve
   capturar stdout/stderr, olhar exit code e decidir. Nao trate "qualquer stderr"
   como falha fatal.

8. O instalador termina em `ogb pass`.

   Nao duplicar ritual manual no PowerShell. `ogb pass` e a unidade canonica que
   roda setup, sync, doctor, validate, security-check e dashboard. Se a sequencia
   muda, muda uma vez no CLI.

9. Update real nao roda no startup por padrao.

   Startup pode fazer check silencioso. Update real e fluxo manual
   (`ogb self-update` ou comando explicito). Auto-update no startup gera ruido,
   corre durante abertura do OpenCode e aumenta muito a chance de estado preso.

10. Dashboard nao pode ser um amplificador de estado velho.

   O dashboard le arquivos persistidos. Ele precisa saber quando um relatorio e
   antigo, de outra versao, de modo projeto antigo, ou de um update que ja foi
   aplicado. `restartRequired` e uma instrucao de transicao, nao uma sentenca
   eterna.

## Bugs reais e licoes

| Sintoma | Causa | Correcao | Teste obrigatorio |
|---|---|---|---|
| `npm warn deprecated...` derruba `self-update` | PowerShell tratou stderr de comando nativo como erro fatal | Capturar stdout/stderr e decidir por exit code | Installer simula npm warning em stderr com exit 0 |
| `ogb` deixa de existir depois de update falho | O instalador removeu shim antigo antes de garantir novo shim funcional | Reparar shim para local estavel; nao apagar o comando em execucao | Self-update falho preserva ou recria `ogb.cmd` |
| `"C:\...\opencode.cmd" nao e reconhecido` | Aspas escapadas foram persistidas ou repassadas como parte do comando | `normalizeCommandInput` remove wrappers externos reais/escapados | `.cmd` quoteado, escapado e aninhado executa via `cmd.exe` |
| `mkdir C:\Users\leona\"C:\Users\leona"\.opencode\generated` | `--project` chegou com aspas literais e deixou de ser reconhecido como home | `normalizePathInput` antes de resolver/comparar paths | Home normal, quoteada e duplamente quoteada tem `homeMode: true` |
| Startup sync ficava `running` por 10 minutos | Lock/status global em local errado ou PID morto nao recuperado | Lock no generated global certo; remover lock com PID morto | Lock com PID morto e vivo; home nao cria `.opencode/generated` |
| Toast de FAIL a cada segundo | Eventos frequentes (`session.updated`, `session.idle`) disparavam sync sem backoff | Startup roda no maximo uma vez por abertura; backoff de falha; throttle de toast | Burst de eventos dispara um sync e no maximo um toast |
| Plugin aparece no debug mas nao sincroniza | Lifecycle do plugin executava comando generico e falhava por lock/PATH | Comando dedicado `startup-sync`, diagnostico com stdout/stderr tails | Plugin gerado tem hook atual, default export e node --check |
| Dashboard `FAIL` mesmo com home global correta | Validate/security antigos procuravam artefatos de projeto em `.opencode` | Validate/security home-aware; extension map global | Home/global nao exige `.opencode/generated` nem `.opencode/agents/YOLO.md` |
| Extensoes Gemini viram warnings permanentes | Extension map nao era gerado no modo global | Gerar `ogb-extension-map.json` global e tratar como inventario | Doctor global nao emite warning generico de extensao |
| Skills contadas a mais | Gemini source e copia OpenCode eram somadas juntas | Inventario/doctor contam recursos OpenCode sem duplicar fonte Gemini | Home com skill fonte + copia nao soma duplicado |
| `restart OpenCode` aparece para sempre apos PASS | Dashboard exigia tag alvo explicita e/ou timestamp posterior | Consumir restart quando reports atuais estao PASS; aceitar self-update `latest` sem `latestTag` | Status updated sem `latestTag` + reports 0.0.x PASS vira current |
| `npm pack --dry-run` sem `dist` | Pack rodou em paralelo enquanto build limpava `dist` | Nunca rodar pack em paralelo com build/clean | Release check deve rodar build antes de pack, sequencialmente |

## Padroes de PowerShell para manter

### Bootstrap

Use `-NoProfile -ExecutionPolicy Bypass` no processo temporario de bootstrap. A
politica de execucao no escopo `Process` nao persiste depois que a sessao fecha,
entao isso evita pedir ao usuario para mudar a maquina inteira.

### Native commands

Para comandos nativos (`node.exe`, `npm.cmd`, `opencode.cmd`, `ogb.cmd`):

- usar arrays de argumentos;
- capturar stdout e stderr separadamente quando o comando faz parte do
  instalador;
- checar `$LASTEXITCODE` ou o exit code do processo;
- desligar comportamento que transforma stderr em excecao quando necessario;
- preservar tails de stdout/stderr em status JSON quando algo falha.

### PATH e variaveis de ambiente

O instalador deve:

- persistir `OPENCODE_ENABLE_EXA=1` no escopo de usuario;
- tambem setar `$env:OPENCODE_ENABLE_EXA = "1"` no processo atual;
- adicionar o diretorio do shim ao PATH de usuario sem duplicar;
- atualizar `$env:Path` no processo atual para que comandos seguintes funcionem;
- nao assumir que o OpenCode ja aberto enxerga mudancas de PATH.

### Paths com espaco

Use call operator com comando separado dos argumentos:

```powershell
& $NodeExe $CliJs --project $Project pass --windows
```

Nao use:

```powershell
& "`"$NodeExe`" `"$CliJs`" --project `"$Project`" pass"
```

No segundo caso, o quoting passa a fazer parte do payload e eventualmente vira
`\"C:\...\node.exe\"`.

## Padroes de Node para manter

### `.cmd` e `.bat`

O runner comum deve decidir por extensao:

- `.exe`: executar direto com `spawn`/`spawnSync`;
- `.cmd`/`.bat`: executar via `cmd.exe /d /s /c` com a linha inteira quoteada;
- usar `windowsVerbatimArguments` quando a linha ja foi montada para `cmd.exe`;
- remover wrappers externos de comando antes de resolver/executar.

### Env no Windows

Windows trata nomes de variaveis sem diferenciar maiusculas/minusculas. Ao
montar `env` para subprocesso, evitar passar variantes concorrentes como
`PATH` e `Path` com valores diferentes.

### Timeouts e diagnostico

Todo processo chamado pelo plugin ou pelo pass deve ter:

- timeout razoavel;
- stdoutTail;
- stderrTail;
- command;
- args;
- exitCode;
- signal;
- startedAt/finishedAt.

Sem isso, o dashboard so consegue dizer "exit code 1", que nao ajuda ninguem.

## Fluxo correto do instalador Windows

1. Normalizar `-Project` e `-Prefix`.
2. Resolver `%USERPROFILE%` e detectar home/global.
3. Baixar release pack para temp.
4. Extrair para temp limpo.
5. Buildar CLI.
6. Instalar em pasta estavel, como `%USERPROFILE%\.ai\opencode-pack\...`.
7. Criar/reparar `ogb.cmd` apontando para `node.exe` + `dist\cli.js`.
8. Persistir PATH de usuario e atualizar PATH do processo.
9. Persistir `OPENCODE_ENABLE_EXA=1` e atualizar o processo.
10. Se home/global, limpar artefatos antigos de projeto na home.
11. Rodar `setup-ux --reset-global` quando o fluxo pede reset/force global.
12. Rodar `import`/`sync`.
13. Rodar `setup-opencode`.
14. Rodar `ogb pass --windows` (com `--force` quando o instalador foi chamado
    com force).
15. Imprimir o comando exato para repetir: `ogb --project "<Project>" pass --windows`.

Se qualquer etapa apos a instalacao do shim falhar, o shim deve continuar
funcional para que o usuario possa rodar `ogb dashboard` ou `ogb pass`.

## Fluxo correto do self-update

`self-update` e mais perigoso que install porque ele roda enquanto o usuario ja
depende do `ogb`.

Regras:

1. Nao destruir o shim atual antes de ter novo CLI funcional.
2. Baixar o release pack, instalar, entao rodar o pass completo.
3. Gravar `ogb-update-status.json` com comando, status, versao alvo quando
   conhecida, postUpdate e diagnostico.
4. Se a versao alvo for `latest`, pode nao existir `latestTag` no status
   produzido pelo comando antigo. Dashboard deve aceitar reports PASS da versao
   atual como prova suficiente para limpar `restartRequired`.
5. O resultado esperado apos update bem-sucedido e:
   - `ogb --version` mostra a versao nova;
   - `ogb pass --windows` passa;
   - `ogb dashboard` nao fica `FAIL` por relatorio antigo;
   - depois do restart, `restartRequired` some.

## Startup plugin

Startup sync deve ser pequeno, previsivel e defensivo:

- usar comando dedicado `startup-sync`, nao `sync` generico;
- rodar no maximo uma vez por abertura do OpenCode;
- nao reagir a `session.updated` e `session.idle` como gatilhos imediatos;
- manter backoff de falha;
- notificar falha no maximo uma vez por processo ou janela de backoff;
- gravar status em generated global quando cwd e home;
- nunca escrever lock/status em `%USERPROFILE%\.opencode\generated` quando home
  e global;
- recuperar lock com PID morto;
- registrar "ja esta rodando" quando PID vivo existe;
- fazer check-update silencioso no maximo, sem aplicar update automaticamente.

## Dashboard e relatorios

O dashboard e um agregador de estado, nao uma fonte primaria. Ele precisa:

- distinguir missing, warn, fail e stale;
- tratar relatorios sem `generatedAt` como antigos quando existe update recente;
- tratar relatorios de versao antiga como WARN para regenerar, nao como falha
  atual;
- no modo home/global, validar paths globais;
- consumir `restartRequired` quando:
  - o update aponta para a versao atual; ou
  - o update nao tem target explicito porque veio de `latest`; e
  - validation e security sao da versao atual; e
  - validation e security estao `pass`.

Nao consumir `restartRequired` se validation/security ainda estao `fail`.

## Testes que precisam existir antes de release

### Unitarios

- `normalizePathInput` com home normal, quoteada, aspas simples, aspas duplas e
  wrappers aninhados.
- `normalizeCommandInput` com `.cmd` quoteado, escapado e aninhado.
- `commandForPlatform`:
  - `.cmd` sem espaco;
  - `.cmd` em `Program Files`;
  - `.cmd` com aspas externas escapadas;
  - `.exe` quoteado executado direto.
- `resolveProjectPaths` com `--project '"<home>"'`.
- `startup-sync` home/global nunca cria `.opencode/generated`.
- `reset --project '"<home>"'` aceita home e limpa status/backoff antigo.
- `dashboard` consome `restartRequired` com target explicito.
- `dashboard` consome `restartRequired` sem target explicito (`latest` antigo).
- `dashboard` nao consome `restartRequired` se validation/security falham.
- `doctor` nao duplica skills quando fonte Gemini e copia OpenCode existem.
- `validate --windows` garante tokens esperados nos instaladores.

### Local antes de tag

Rodar em ordem, sem paralelizar build com pack:

```bash
cd packages/ogb
npm test
npm run typecheck
npm run build
node dist/cli.js --project /path/to/repo pass --force --windows
npm pack --dry-run
```

### Release

Depois de tag/push:

1. Esperar `Validate OpenCode Gemini Bridge` na tag.
2. Esperar `Validate OpenCode Gemini Bridge` no main.
3. Esperar `Release Pack`.
4. Baixar o zip/tgz publicados.
5. Confirmar `package.json.version`.
6. Confirmar que `packages/ogb/dist/*.js` existe no zip.
7. Grepar o fix esperado dentro do `dist`, nao so no `src`.

## Matriz Windows minima

Testar pelo menos estes cenarios antes de declarar "Windows esta pronto":

- PowerShell 7.
- Windows PowerShell 5.1, se ainda suportado.
- Node instalado em `C:\Program Files\nodejs`.
- `npm.cmd`, `node.exe`, `opencode.cmd` e `gemini.cmd` fora do PATH inicial.
- `%USERPROFILE%` com path normal.
- `--project` quoteado: `"C:\Users\..."`.
- `--project` duplamente quoteado: `'"C:\Users\..."'`.
- Home/global.
- Projeto real fora da home.
- OpenCode ja aberto antes de PATH mudar.
- `self-update --release vX.Y.Z`.
- `self-update` sem release explicito, usando `latest`.
- Startup sync com evento em rajada.
- Startup sync com lock morto.
- Startup sync com comando ausente.

## Como depurar sem adivinhar

Pedir estes arquivos/saidas primeiro:

```powershell
ogb --version
ogb pass --windows
ogb dashboard
ogb doctor
Get-Command ogb, node, npm, opencode, gemini -ErrorAction SilentlyContinue
$env:Path
[Environment]::GetEnvironmentVariable("Path", "User")
[Environment]::GetEnvironmentVariable("OPENCODE_ENABLE_EXA", "User")
```

Arquivos importantes no modo home/global:

```text
%USERPROFILE%\.config\opencode\opencode.json
%USERPROFILE%\.config\opencode\agents\YOLO.md
%USERPROFILE%\.config\opencode-gemini-bridge\generated\GEMINI.expanded.md
%USERPROFILE%\.config\opencode-gemini-bridge\generated\ogb-dashboard.json
%USERPROFILE%\.config\opencode-gemini-bridge\generated\ogb-plugin-status.json
%USERPROFILE%\.config\opencode-gemini-bridge\generated\ogb-update-status.json
%USERPROFILE%\.config\opencode-gemini-bridge\generated\ogb-validation.json
%USERPROFILE%\.config\opencode-gemini-bridge\generated\ogb-security.json
```

Se algum arquivo novo aparece em `%USERPROFILE%\.opencode\generated` durante home
mode, isso e regressao.

## Coisas que parecem boa ideia e nao sao

- "Vamos pedir reset." Reset e ultimo recurso. Se `pass` esta limpo, o dashboard
  deve aprender a ler o estado.
- "Vamos rodar doctor, validate, security e dashboard no instalador." Isso
  duplica o ritual. Use `ogb pass`.
- "Vamos usar o PATH." O OpenCode pode nao herdar o PATH novo.
- "Vamos montar uma string de comando." Use comando + array de argumentos.
- "Vamos tratar qualquer stderr como erro." `npm` escreve warning em stderr.
- "Vamos rodar update no startup." Startup deve ser leve; update e ato humano.
- "Vamos testar so no Mac com `--windows`." Isso ajuda, mas nao substitui smoke
  em Windows real.
- "Vamos olhar so `src` no release." Usuario baixa o `dist` do asset publico.

## Notas sobre transformar em skill

Eu pesquisei referencias abertas de Agent Skills. O padrao comum e:

- skill e workflow, nao enciclopedia;
- `SKILL.md` tem frontmatter com `name` e `description`;
- a description precisa dizer quando usar;
- o corpo deve ter processo, red flags e verificacao;
- referencias longas podem ficar separadas e serem carregadas sob demanda;
- skills podem executar codigo, entao precisam ser revisadas antes de uso.

Se este documento virar uma skill, o `SKILL.md` deve ser curto e apontar para
este arquivo como referencia. Sugestao:

```yaml
---
name: ogb-windows-installer-hardening
description: Guides OGB Windows installer, self-update, startup plugin, dashboard, and release hardening. Use when changing PowerShell installers, command runners, Windows path handling, startup sync, or update/dashboard status.
---
```

Processo da skill:

1. Ler `docs/20-windows-installer-lessons.md`.
2. Identificar qual fronteira mudou: PowerShell, Node runner, startup plugin,
   dashboard, self-update, global home, release pack.
3. Adicionar teste de regressao antes ou junto da mudanca.
4. Rodar suite completa.
5. Rodar pack depois do build, nunca em paralelo.
6. Conferir asset publicado quando houver release.

## Fontes consultadas

- Node.js `child_process`: `.bat`/`.cmd` precisam ser invocados via shell ou
  `cmd.exe`, e `windowsVerbatimArguments` controla escaping no Windows:
  https://nodejs.org/docs/latest/api/child_process.html
- PowerShell preference variables: comportamento de comandos nativos,
  `$PSNativeCommandArgumentPassing` e `$PSNativeCommandUseErrorActionPreference`:
  https://learn.microsoft.com/en-ca/powershell/module/microsoft.powershell.core/about/about_preference_variables
- PowerShell environment variables: diferenca entre Process, User e Machine
  scopes e persistencia via `System.Environment`:
  https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_environment_variables
- PowerShell parsing: modo de argumentos, quote handling e mudancas de
  PowerShell 7.3 para comandos nativos:
  https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_parsing
- PowerShell execution policies: `Process` scope e por que usar bypass so na
  sessao temporaria de bootstrap:
  https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_execution_policies
- Agent Skills, getting started: skills como workflows com verificacao e red
  flags:
  https://github.com/addyosmani/agent-skills/blob/main/docs/getting-started.md
- Agent Skills, anatomy: frontmatter obrigatorio, description e secoes
  recomendadas:
  https://github.com/addyosmani/agent-skills/blob/main/docs/skill-anatomy.md
- Pi skills docs: locais de descoberta, seguranca e formato `SKILL.md`:
  https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/skills.md
