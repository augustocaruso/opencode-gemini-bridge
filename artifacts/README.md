# Artifacts

Este diretório contém templates e scaffolding para implementar o projeto.

## Conteúdo

```text
opencode/
  global-opencode.jsonc
  project-opencode.jsonc
  plugins/
    ogb-startup-sync.js
  agents/
  commands/

scripts/
  expand-gemini.mjs
  expand-gemini.ps1
  ogb-mac.sh
  ogb-windows.ps1
  install-mac.sh
  install-windows.ps1
  upgrade-mac.sh
  uninstall-mac.sh

bridge-cli-skeleton/
  package.json
  tsconfig.json
  src/

github-actions/
  validate-ogb.yml
  release-pack.yml

schemas/
  inventory.schema.json
  gemini-extension-compat.schema.json
```

## Como usar no MVP

1. Entre em `bridge-cli-skeleton/`.
2. Rode `npm install`.
3. Rode `npm run build`.
4. Em um projeto Gemini, rode `node dist/cli.js --project /caminho/do/projeto import`.
5. Rode `node dist/cli.js --project /caminho/do/projeto setup-opencode`.
6. Revise `ogb doctor` e `ogb dashboard`.
7. Abra OpenCode.

Atalho depois que o binário `ogb` estiver no PATH:

```bash
ogb import
ogb setup-opencode
ogb sync
ogb doctor
ogb dashboard
```

Recursos adicionais:

```bash
ogb trust-extension <name> --hook hooks/hooks.json
ogb bidirectional-sync --dry-run
ogb sync --bidirectional --dry-run
```

Rulesync é usado em staging temporário quando disponível. Para exigir Rulesync na importação inicial:

```bash
ogb import --rulesync require
```

Para instalar o plugin que roda sync quando o OpenCode inicia:

```bash
ogb setup-opencode
```

Ele copia o plugin para `.opencode/plugins/ogb-startup-sync.js`, grava `.opencode/generated/ogb-startup-sync.json`, valida a sintaxe do plugin, grava status em `.opencode/generated/ogb-plugin-status.json` e atualiza `.opencode/generated/ogb-dashboard.md`.

Para gerar um pacote npm local instalável:

```bash
cd bridge-cli-skeleton
npm run pack:local
```

Saída atual:

```text
opencode-gemini-bridge-0.0.17.tgz
```

## Importante

O CLI em `bridge-cli-skeleton` agora é o caminho principal do MVP. Os scripts
Mac instalam, atualizam ou removem a CLI global e rodam smoke checks. Windows
ainda e fase posterior.

Checks minimos antes de publicar:

```bash
cd artifacts/bridge-cli-skeleton
npm run typecheck
npm test
npm run build
node --check dist/tui-sidebar.js
npm pack --dry-run
```
