# OGB patch API

## Objetivo

A patch API e o caminho seguro para rodar correcoes pontuais versionadas no computador do usuario durante rituais do OGB. Ela existe para evitar scripts soltos em instaladores, bootstrap PowerShell/shell ou comandos escondidos.

O modelo mental:

- um patch declara metadata, fase, plataformas e risco;
- o runner decide se ele se aplica;
- o patch roda com acesso a backup central, paths normalizados e native runner;
- o resultado vira progresso, warning/error do `ogb check` e estado persistido.

## Fases

As fases sao strings estaveis e ordenaveis:

- `pre-install`
- `post-install`
- `pre-extension-update`
- `post-extension-update`
- `pre-sync`
- `post-sync`
- `pre-doctor`
- `post-check`
- `post-update`

Hoje o `ogb check` executa as fases de check nesta ordem:

1. `pre-extension-update`
2. update de Gemini extensions
3. `post-extension-update`
4. `pre-sync`
5. sync
6. `post-sync`
7. `pre-doctor`
8. doctor, hook review, validation, security e dashboard
9. `post-check`

`ogb update` herda estes patches pelo post-update check: depois que o bootstrap instala a nova versao, o ritual chama o `ogb check` da instalacao nova, entao os patches tambem vem da versao nova.

`reset` nao roda patches de check diretamente; quando precisar herdar patches, rode `ogb check` depois do reset ou faca o fluxo que chama check.

## Hook por extensao Gemini

O update de Gemini Extensions tem um hook especial antes do Gemini CLI tocar nas pastas instaladas:

```ts
runBeforeGeminiExtensionUpdatePatches({
  extension: {
    name: "medical-notes-workbench",
    extensionPath: "~/.gemini/extensions/medical-notes-workbench",
    manifestPath: "~/.gemini/extensions/medical-notes-workbench/gemini-extension.json",
    currentVersion: "0.3.10",
    targetVersion: undefined,
    currentRef: "main",
    targetRef: undefined,
  },
});
```

Esse hook roda dentro de `updateGeminiExtensions` antes de `gemini extensions update --all` ou `gemini extensions update <name>`. Se um patch `required` falha, o update fica `blocked` e o Gemini CLI nao e chamado.

O OGB consegue saber antes do update:

- nome da extensao;
- path instalado;
- path do manifesto;
- versao/ref atuais quando existem no `gemini-extension.json`.

O target exato pode ficar `undefined` quando o Gemini CLI nao expuser um dry-run/resolved target antes do update. Depois do comando, o report de update inclui `afterExtensions` para comparar o estado instalado.

## Contrato de um patch

Um patch vive em `packages/ogb/src/patches.ts` e segue este formato:

```ts
export interface OgbPatch {
  id: string;
  title: string;
  description: string;
  introducedIn: string;
  phase: PatchPhase;
  platforms?: PatchPlatform[];
  runOnce?: boolean;
  destructive?: boolean;
  needsBackup?: boolean;
  required?: boolean;
  timeoutMs?: number;
  applies(context: PatchContext): boolean;
  run(context: PatchContext): PatchResult;
}
```

Regras:

- `id` deve ser unico e estavel.
- `introducedIn` deve apontar a versao que introduziu o patch.
- `runOnce` pula execucoes futuras depois de um `applied`, exceto com `force`.
- `required` transforma falha em erro de check; patch opcional vira warning.
- `destructive` e `needsBackup` devem ser verdadeiros quando o patch remove ou sobrescreve arquivo.
- `applies` nao deve escrever nada.
- `run` deve respeitar `context.dryRun`.

## Contexto disponivel

`PatchContext` entrega:

- `projectRoot`, `homeDir`, `homeMode` e `paths` ja normalizados;
- `adapter` e `platform` para diferencas Mac/Windows/Linux;
- `dryRun`, `force` e `now`;
- `backupSession.backupExisting(filePath)` para backup central;
- `runCommand(spec)` para executar comandos via `native-runner`.

Nunca monte comando Windows manualmente. Use `context.runCommand`; ele herda o runner que trata `.cmd`, `.bat`, `.exe`, quotes e cwd.

Patches rodam como API interna Node do OGB. Quando precisam chamar ferramentas nativas, use `context.runCommand`. No Windows isso continua passando pelo native runner; logo `git diff --binary`, PowerShell, `.cmd` e `.exe` seguem o mesmo contrato testado do instalador.

## Estado e diagnostico

O estado persistido fica em:

- home/global: `~/.config/opencode-gemini-bridge/generated/ogb-patches.json`
- projeto: `.opencode/generated/ogb-patches.json`

O arquivo guarda:

- schema `opencode-gemini-bridge.patches.v1`;
- patches aplicados;
- historico curto de runs;
- outcome por fase.

O `PassReport` tambem ganha `patches`, com fases, contadores e path do estado.

## Progresso

As fases de check aparecem no contrato publico `--progress-json` e na UI viva como TODOs:

- `patches-pre-extension-update`
- `patches-post-extension-update`
- `patches-pre-sync`
- `patches-post-sync`
- `patches-pre-doctor`
- `patches-post-check`

`ogb check --no-patches` remove essas fases e nao executa patches.

## Patch do Medical Notes Workbench

O registry inclui `medical-notes-workbench-pre-update-snapshot`.

Regra:

- sem drift local relevante: o patch retorna `skipped` e o update continua;
- drift apenas em metadados/ruido de instalacao, como
  `.gemini-extension-install.json`: o patch retorna `skipped`, registra o
  caminho como ignorado na mensagem e o update continua;
- com drift e snapshot OK: o snapshot e gravado e o update continua;
- com drift e snapshot falhou: o patch retorna `failed`, e por ser `required`, o update de Gemini Extensions fica `blocked`.
- com drift relevante detectado mas sem diff/script util capturado: o patch
  retorna `failed` e bloqueia o update.

Para evitar snapshots vazios ou ruidosos, o patch so considera arquivos
allowlisted da extensao:

- `GEMINI.md`
- `commands/`
- `skills/`
- `agents/`
- `knowledge/`
- `hooks/`
- `scripts/`
- `src/`
- `docs/`

Arquivos `.env*`, `telemetry.defaults.json` e metadados de instalacao ficam
fora do snapshot.

O snapshot persistente e gravado fora da pasta da extensao:

```text
~/.gemini/medical-notes-workbench/feedback/pre-update-snapshots/<snapshot-id>/
  snapshot.json
  tracked.diff
  staged.diff
  untracked.diff
```

`snapshot.json` usa schema `medical-notes-workbench.pre-update-extension-snapshot.v1` e contem pelo menos:

- `snapshot_id`
- `recorded_at`
- `extension_name`
- `extension_path`
- `snapshot_path`
- `current_version`
- `target_version`
- `git_head`
- `changed_path_count`
- `untracked_path_count`
- `ignored_path_count`
- `changed_paths`
- `untracked_paths`
- `ignored_paths`
- `snapshot_useful`
- `generated_scripts`

Os diffs tracked/staged usam `git diff --binary` limitado a allowlist acima.
O diff de untracked concatena diffs `git diff --binary --no-index` para
preservar conteudo novo antes do update. Scripts operacionais allowlisted com
extensao `.py`, `.js`, `.mjs`, `.cjs`, `.sh`, `.ps1` ou `.cmd` tambem entram em
`generated_scripts` com linguagem, tamanho e conteudo quando estiverem abaixo do
limite de captura.

## Como adicionar um patch

Checklist minimo:

1. Adicione o patch em `OGB_PATCHES`.
2. Escolha a fase mais estreita possivel.
3. Marque `platforms` se o patch nao for universal.
4. Use `backupSession` antes de qualquer overwrite/remove.
5. Retorne `preview` em `dryRun`.
6. Adicione teste unitario em `patches.test.ts`.
7. Se o patch influencia o check, adicione teste em `pass.test.ts`.
8. Rode `npm run typecheck` e `npm test` em `packages/ogb`.

## Exemplo

```ts
{
  id: "cleanup-legacy-home-startup-lock",
  title: "Remove legacy home startup lock",
  description: "Removes an old lock from a previous home/global startup bug.",
  introducedIn: OGB_VERSION,
  phase: "pre-extension-update",
  platforms: ["all"],
  destructive: true,
  needsBackup: true,
  required: false,
  applies(context) {
    return context.homeMode && fs.existsSync(lockPath(context));
  },
  run(context) {
    const target = lockPath(context);
    context.backupSession.backupExisting(target);
    if (!context.dryRun) fs.rmSync(target, { force: true });
    return {
      status: context.dryRun ? "preview" : "applied",
      message: context.dryRun ? `Would remove ${target}.` : `Removed ${target}.`,
      writes: [target],
      backups: [...context.backupSession.backups],
    };
  },
}
```
